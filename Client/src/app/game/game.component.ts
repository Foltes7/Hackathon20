import {
  Component,
  OnInit,
  Output,
  EventEmitter,
  ChangeDetectorRef
} from '@angular/core';
import { UserService } from 'src/Services/user.service';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { User } from 'src/Models/User';
import { Router } from '@angular/router';
import { AuthService } from 'src/Services/auth.service';
import { GameService } from 'src/Services/game.service';
import { Game } from 'src/Models/Game';
import { NewLyricsAttempt } from 'src/Models/NewAttemptLyrics';
import { Attempt } from 'src/Models/Attempt';
import { WrongAttempt } from 'src/Models/WrongAttempt';
import { isNull } from 'util';
import { DeezerService } from 'src/Services/deezer.service';
import { ResponseSearch } from 'src/Models/Deezer/ResponseSearch';
import { ResponseSound } from 'src/Models/Deezer/ResponseSound';
import { DomSanitizer } from '@angular/platform-browser';
import { HttpEventType } from '@angular/common/http';
import Recorder from 'recorder-js';
import { Statistic } from 'src/Models/Statistic';

declare var MediaRecorder: any;

@Component({
  selector: 'app-game',
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.sass']
})
export class GameComponent implements OnInit {

  statistic: Statistic;
  history = false;

  blobFile;
  recordAudio;
  sendObj = {
    audio: this.blobFile
  };
  audioContext = new (AudioContext)({ sampleRate: 16000 });
  recorder = new Recorder(this.audioContext, {});
  mic = false;

  unsubscribe = new Subject();
  user: User;
  game: Game;
  lyrics = '';
  currentAttempt: Attempt;
  listAttempts: boolean[] = [];
  loading = false;

  resposeLyrics: ResponseSound[];
  attemptSoundId;

  constructor(
    private router: Router,
    private authService: AuthService,
    private userService: UserService,
    private gameService: GameService,
    private deezerService: DeezerService,
    private sanitizer: DomSanitizer,
    private cd: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.initializeMic();
    this.userService
      .Get()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        user => {
          this.user = user;
          this.newGame();
        },
        error => {
          this.router.navigate(['/about']);
        }
      );
    this.userService.GetStat()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(x => this.statistic = x, error => console.log(error));
  }


  initializeMic() {
    this.recordAudio = () => {
      return new Promise(resolve => {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            const mediaRecorder = new MediaRecorder(stream, {
              mimeType: 'audio/webm',
              numberOfAudioChannels: 1,
              audioBitsPerSecond: 16000,
            });
            const audioChunks = [];

            mediaRecorder.addEventListener('dataavailable', event => {
              audioChunks.push(event.data);
            });

            const start = () => {
              mediaRecorder.start();
            };

            const stop = () => {
              // tslint:disable-next-line:no-shadowed-variable
              return new Promise(resolve => {
                mediaRecorder.addEventListener('stop', () => {
                  const audioBlob = new Blob(audioChunks, { type: 'audio/ogg' });
                  this.uploadVoice(audioBlob);
                  const reader = new FileReader();
                  reader.readAsDataURL(audioBlob);
                  reader.addEventListener('load', () => {
                  }, false);
                  resolve({ audioBlob });
                });

                mediaRecorder.stop();
              });
            };
            resolve({ start, stop });
          });
      });
    };
  }
  state() {
    if (this.mic) {
      this.stopPlay();
    } else {
      this.startPlay();
    }
    this.mic = !this.mic;
  }
  async startPlay() {
    this.recorder = await this.recordAudio();
    this.recorder.start();
  }

  async stopPlay() {
    await this.recorder.stop();
  }
  newGame() {
    this.gameService
      .newGame()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        game => {
          this.game = game;
        },
        error => console.log(error)
      );
  }

  returnSrc() {
    if (!this.attemptSoundId) {
      return;
    }
    // tslint:disable-next-line:max-line-length
    const baseUrl =
      // tslint:disable-next-line:max-line-length
      'https://www.deezer.com/plugins/player?format=classic&autoplay=false&playlist=true&width=350&height=140&color=ff0000&layout=dark&size=medium&type=tracks&id=';
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      baseUrl + this.attemptSoundId.toString() + '&app_id=1'
    );
  }

  refresh() {
    window.location.reload();
  }

  endGame() {
    if (this.game === undefined) {
      return;
    }
    this.gameService
      .endGame(this.game.id)
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        game => {
          this.router.navigate(['']);
        },
        error => console.log(error)
      );
  }

  uploadFile(files) {
    if (files.length === 0) {
      return;
    }
    if (files[0].type !== 'audio/mp3') {
      return;
    }
    const formData = new FormData();

    formData.append('GameId', this.game.id.toString());
    formData.append('FormData', files[0]);

    this.loading = true;

    this.gameService
      .newAttemptByFile(formData)
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        event => {
          if (event.type === HttpEventType.UploadProgress) {
          } else if (event.type === HttpEventType.Response) {

            if (isNull(event.body)) {
              this.gameService
                .endGameLose(this.game.id)
                .pipe(takeUntil(this.unsubscribe))
                .subscribe(
                  game => {
                    this.game = game;
                  },
                  error => console.log(error)
                );
              this.loading = false;
              this.listAttempts.push(true);
              return;
            }


            this.currentAttempt = event.body;
            this.loading = false;

            this.deezerService
              .searchByTrackName(
                this.currentAttempt.lyricsSound.artist,
                this.currentAttempt.lyricsSound.title
              )
              .subscribe(
                x => {
                  this.resposeLyrics = x;
                  if (this.resposeLyrics) {
                    this.attemptSoundId = this.resposeLyrics[0].id;
                  }
                },
                error => console.log(error)
              );
          }
        },
        error => {
          this.loading = false;
        }
      );
  }

  endGameWon() {
    this.gameService
      .endGameLose(this.game.id)
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        game => {
          this.loading = false;
          this.listAttempts.push(true);
          this.game = game;
        },
        error => console.log(error)
      );
  }
  uploadVoice(file) {
    if (file.type !== 'audio/ogg') {
      return;
    }
    const formData = new FormData();

    formData.append('GameId', this.game.id.toString());
    formData.append('FormData', file);

    this.loading = true;

    this.gameService
      .newAttemptByVoice(formData)
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        event => {
          if (!event) {

            this.endGameWon();
          } else {
            this.currentAttempt = event;
            this.loading = false;
            this.deezerService
              .searchByTrackName(
                this.currentAttempt.lyricsSound.artist,
                this.currentAttempt.lyricsSound.title
              )
              .pipe(takeUntil(this.unsubscribe))
              .subscribe(
                x => {
                  this.resposeLyrics = x;
                  if (this.resposeLyrics) {
                    this.attemptSoundId = this.resposeLyrics[0].id;
                  }
                },
                error => console.log(error)
              );
          }

        },
        error => {
          console.log(5);
          this.loading = false;
        }
      );
  }


  findSound() {
    if (!this.lyrics) {
      return;
    }

    this.loading = true;
    const attempt: NewLyricsAttempt = {
      gameId: this.game.id,
      lyrics: this.lyrics
    };
    this.gameService
      .newAttempt(attempt)
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        att => {
          if (isNull(att)) {
            this.gameService
              .endGameLose(this.game.id)
              .pipe(takeUntil(this.unsubscribe))
              .subscribe(
                game => {
                  this.game = game;
                },
                error => console.log(error)
              );
            this.loading = false;
            this.listAttempts.push(true);
            return;
          }
          this.currentAttempt = att;
          this.loading = false;

          this.deezerService
            .searchByTrackName(
              this.currentAttempt.lyricsSound.artist,
              this.currentAttempt.lyricsSound.title
            )
            .subscribe(
              x => {
                this.resposeLyrics = x;
                if (this.resposeLyrics.length > 0) {
                  this.attemptSoundId = this.resposeLyrics[0].id;
                }
              },
              error => console.log(error)
            );
        },
        error => {
          console.log(error);
          this.loading = false;
        }
      );
  }

  rightAnswer() {
    this.gameService
      .rightAnswer(this.currentAttempt.id)
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        game => {
          this.game = game;
          this.listAttempts.push(false);
        },
        error => console.log(error)
      );
  }

  wrongAnswer() {
    const attempt: WrongAttempt = {
      id: this.currentAttempt.id,
      gameId: this.game.id,
      lyrics: this.lyrics
    };
    this.gameService
      .wrongAnswer(attempt)
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        att => {
          if (isNull(att)) {
            this.game.won = true;
            this.game.ended = true;
            this.listAttempts.push(true);
          } else {
            this.currentAttempt = att;
            this.listAttempts.push(true);

            this.deezerService
              .searchByTrackName(
                this.currentAttempt.lyricsSound.artist,
                this.currentAttempt.lyricsSound.title
              )
              .subscribe(
                x => {
                  this.resposeLyrics = x;
                  if (this.resposeLyrics.length > 0) {
                    this.attemptSoundId = this.resposeLyrics[0].id;
                  }
                },
                error => console.log(error)
              );
          }
        },
        error => console.log(error)
      );
  }

  exit() {
    this.authService.SignOut();
  }
}
