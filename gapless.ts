/**
 * Created by alecgorge on 5/7/15.
 */

enum GaplessPlaybackState {
    Stopped,
    Buffering,
    Playing,
    ReadyToSwitchToWebAudio,
    Paused
}

interface GaplessPlaybackInfo {
    state : GaplessPlaybackState;
    stateDescription : string;
    url : string;
    duration : number;
    elapsed : number;
}

class GaplessPlayback {
    private context : AudioContext;
    private gainNode : GainNode;

    private currentTrack : GaplessTrack;
    private nextTrack : GaplessTrack;

    public onNeedsNextUrl : (cb : (url : string) => void) => void;
    public onStarted : (url : string) => void;
    public onEnded : (oldUrl : string, hasNext : boolean) => void;
    public onPlaybackUpdate : (info : GaplessPlaybackInfo) => void;

    constructor() {
        this.context = ("webkitAudioContext" in window) ?  new window["webkitAudioContext"]() : new AudioContext();
        this.gainNode = this.context.createGain();
        this.gainNode.gain.value = 1;

        this.gainNode.connect(this.context.destination);
    }

    private buildTrackForUrl(url : string) : GaplessTrack {
        var t : GaplessTrack = new GaplessTrack(this.context, this.gainNode, url);
        t.onPrepareNextTrack = () => {
            this.onNeedsNextUrl((nextUrl : string) => {
                if(nextUrl != null) {
                    this.nextTrack = this.buildTrackForUrl(nextUrl);
                    this.nextTrack.load();
                }
            });
        };

        t.onEnded = () => {
            var oldUrl : string = this.currentTrack.url;

            if(this.nextTrack) {
                this.nextTrack.play();
                this.currentTrack = this.nextTrack;
                this.onStarted(this.currentTrack.url);
                this.nextTrack = null;
            }
            else {
                this.currentTrack = null;
            }

            this.onEnded(oldUrl, this.currentTrack != null);
        };

        return t;
    }

    private stateToString(state : GaplessPlaybackState) : string {
        if(state == GaplessPlaybackState.Buffering) {
            return "buffering";
        }
        else if(state == GaplessPlaybackState.Paused) {
            return "paused";
        }
        else if(state == GaplessPlaybackState.Playing) {
            return "playing";
        }
        else if(state == GaplessPlaybackState.ReadyToSwitchToWebAudio) {
            return "ready to switch to web audio";
        }
        else if(state == GaplessPlaybackState.Stopped) {
            return "stopped";
        }

        return "unknown state";
    }

    private startUpdates() {
        setInterval(() => {
            if(!this.currentTrack) {
                return;
            }

            this.onPlaybackUpdate({
                stateDescription: this.stateToString(this.currentTrack.state),
                state: this.currentTrack.state,
                url: this.currentTrack.url,
                duration: this.currentTrack.duration(),
                elapsed: this.currentTrack.elapsed()
            });
        }, 3000);
    }

    public setCurrentTrack(url : string ) {
        if(url != null) {
            this.currentTrack = this.buildTrackForUrl(url);
        }
    }

    public load(url : string) {
        if(url) {
            this.setCurrentTrack(url);
            this.currentTrack.load();
        }
        else if(this.currentTrack == null) {
            this.onNeedsNextUrl((url : string) => {
                this.setCurrentTrack(url);
                this.currentTrack.load();
            });
        }
        else {
            this.currentTrack.load();
        }
    }

    public play(url : string) {
        if(url) {
            this.startUpdates();
            this.setCurrentTrack(url);
            this.currentTrack.play();
            this.onStarted(this.currentTrack.url);
        }
        else if(this.currentTrack) {
            this.startUpdates();
            this.currentTrack.play();
            this.onStarted(this.currentTrack.url);
        }
    }

    public pause() {
        if(this.currentTrack) {
            this.currentTrack.pause();
        }
    }

    public next() {
        if(this.nextTrack) {
            this.currentTrack.pause();
            this.nextTrack.play();
            this.currentTrack = this.nextTrack;
            this.nextTrack = null;
        }
    }

    public duration() {
        if(this.currentTrack) {
            return this.currentTrack.duration();
        }

        return -1;
    }

    public elapsed() {
        if(this.currentTrack) {
            return this.currentTrack.elapsed();
        }

        return -1;
    }

    public seekToPercent(p : number) {
        if(this.currentTrack) {
            return this.currentTrack.seekToPercent(p);
        }
    }

    public seekToTime(t : number) {
        if(this.currentTrack) {
            return this.currentTrack.seekToTime(t);
        }
    }
}

enum GaplessTrackSource {
    HTMLAudioElement,
    WebAudio
}

class GaplessTrack {
    private context : AudioContext;
    private gainNode : GainNode;

    private audio : HTMLAudioElement;
    public url : string;
    private source : GaplessTrackSource;
    public state : GaplessPlaybackState;

    private currentSourceNode : AudioBufferSourceNode;

    private bufferStartTime : number = 0;
    private bufferStartOffset : number = 0;
    private bufferStartOffsetFromHTMLAudio : number = 0;

    public onPrepareNextTrack : () => void = null;
    public onEnded : () => void = null;

    constructor(context : AudioContext, gainNode : GainNode, url : string) {
        this.context = context;
        this.gainNode = gainNode;
        this.audio = new Audio();
        this.audio.src = url;
        this.audio.controls = false;
        this.audio.preload = "auto";
        this.audio.volume = 1;
        this.audio.onerror = (e: Event) => {
            console.log(e);
        };
        this.url = url;

        this.state = GaplessPlaybackState.Stopped;
        this.source = GaplessTrackSource.HTMLAudioElement;
    }

    public getAudio() : HTMLAudioElement {
        return this.audio;
    }

    public clearAudio() : void {
        this.audio = null;
    }

    private buf : AudioBuffer;
    public setFullBuffer(buf : AudioBuffer) : void {
        this.buf = buf;
    }

    public getFullBuffer() : AudioBuffer {
        return this.buf;
    }

    private loadBuffer(context : AudioContext, cb : (buf : AudioBuffer) => void) : void {
        var request : XMLHttpRequest = new XMLHttpRequest();
        request.open('get', this.url, true);
        request.responseType = 'arraybuffer';
        request.onload = () => {
            context.decodeAudioData(request.response, (buffer : AudioBuffer) => {
                cb(buffer);
            });
        };
        request.send();
    }

    private makeNewSourceNode() : AudioBufferSourceNode {
        var s : AudioBufferSourceNode = this.context.createBufferSource();
        s.buffer = this.getFullBuffer();
        s.connect(this.gainNode);
        s.onended = () => {
            if(this.onEnded != null) {
                this.onEnded();
            }
        };

        return s;
    }

    private switchToWebAudio() {
        this.debug("switching to web audio...");

        this.currentSourceNode = this.makeNewSourceNode();

        console.log("context: %f, audio: %f", this.context.currentTime, this.getAudio().currentTime);
        this.bufferStartTime = this.context.currentTime;
        this.bufferStartOffsetFromHTMLAudio = this.getAudio().currentTime;
        this.currentSourceNode.start(0, this.getAudio().currentTime);
        this.getAudio().pause();
        this.clearAudio();

        this.source = GaplessTrackSource.WebAudio;

        this.debug("...done. Did you hear a blip!?");

        this.state = GaplessPlaybackState.Playing;

        if(this.onPrepareNextTrack != null) {
            this.onPrepareNextTrack();
        }
    }

    private attemptSwitchToWebAudio() {
        // we can't switch to web audio unless we have actually played
        // the HTML5 audio for a few seconds to avoid the blip
        this.debug("attempting to switch to web audio...");
        console.log(this.getAudio());
        console.log(this.getAudio().played);
        if(this.getAudio() != null && this.getAudio().played.length > 0) {
            this.switchToWebAudio();
        }
    }

    private debug(s : string) {
        console.log(this.url + ": " + s);
    }

    private hasAttemptedLoad : boolean = false;
    public load() {
        if(!this.hasAttemptedLoad) {
            this.hasAttemptedLoad = true;
            this.debug("loading HTML5 audio...");

            this.audio.load();

            this.state = GaplessPlaybackState.Buffering;

            this.audio.addEventListener("playing", (e: Event) => {
                if(this.state != GaplessPlaybackState.ReadyToSwitchToWebAudio) {
                    this.state = GaplessPlaybackState.Playing;
                }
            });

            this.audio.addEventListener("canplay", (e:Event) => {
                this.debug("can play HTML5 audio");
                this.state = GaplessPlaybackState.Paused;
            });

            this.audio.addEventListener("canplaythrough", (e:Event) => {
                this.debug("HTML5 audio fully loaded");

                this.loadBuffer(this.context, (buf:AudioBuffer) => {
                    this.state = GaplessPlaybackState.ReadyToSwitchToWebAudio;

                    this.debug("audio parsed");

                    this.setFullBuffer(buf);
                    this.attemptSwitchToWebAudio();
                });
            });

            this.audio.addEventListener("ended", (e: Event) => {
                if(this.onEnded != null) {
                    this.onEnded();
                }
            });
        }
    }

    public duration() : number {
        if(this.source == GaplessTrackSource.HTMLAudioElement) {
            return this.getAudio().duration;
        }
        else {
            return this.getFullBuffer().duration;
        }
    }

    public play() {
        if(this.state == GaplessPlaybackState.ReadyToSwitchToWebAudio) {
            this.debug("play requested with full web audio buffer. playing html5 first");
            this.getAudio().play();
            this.state = GaplessPlaybackState.Playing;

            setTimeout(() => {
                this.attemptSwitchToWebAudio();
            }, 500);
            return;
        }

        this.load();

        if(this.source == GaplessTrackSource.HTMLAudioElement) {
            this.getAudio().play();
        }
        else {
            if(this.state == GaplessPlaybackState.Paused) {
                this.bufferStartTime = this.context.currentTime;
                this.bufferStartOffsetFromHTMLAudio = this.bufferStartOffset + this.bufferStartOffsetFromHTMLAudio;
                this.seekToTime(this.bufferStartOffset);
            }
            else {
                this.debug("huh? tried playing web audio before html5 audio because it never got to a paused state");
            }
        }

        this.state = GaplessPlaybackState.Playing;
    }

    public pause() {
        if(this.source == GaplessTrackSource.HTMLAudioElement) {
            this.getAudio().pause();
        }
        else {
            this.bufferStartOffset += this.context.currentTime - this.bufferStartTime;

            this.currentSourceNode.onended = null;
            this.currentSourceNode.stop(0);
        }

        this.state = GaplessPlaybackState.Paused;
    }

    public seekToPercent(p : number) {
        this.seekToTime(p * this.duration());
    }

    public seekToTime(t : number) {
        if(this.source == GaplessTrackSource.HTMLAudioElement) {
            this.getAudio().currentTime = t;
        }
        else {
            var oldNode : AudioBufferSourceNode = this.currentSourceNode;
            this.currentSourceNode = this.makeNewSourceNode();

            this.bufferStartTime = this.context.currentTime;
            this.bufferStartOffsetFromHTMLAudio = t;
            this.currentSourceNode.start(0, t);
            oldNode.onended = null;
            oldNode.stop();
        }
    }

    public elapsed() : number {
        if(this.source == GaplessTrackSource.HTMLAudioElement) {
            return this.getAudio().currentTime;
        }
        else {
            if(this.state == GaplessPlaybackState.Playing) {
                return this.context.currentTime - this.bufferStartTime + this.bufferStartOffsetFromHTMLAudio;
            }
            else {
                return this.bufferStartOffset + this.bufferStartOffsetFromHTMLAudio;
            }
        }
    }

    public getState() {
        return this.state;
    }
}
