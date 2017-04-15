/**
 * Created by alecgorge on 5/7/15.
 */
var GaplessPlaybackState;
(function (GaplessPlaybackState) {
    GaplessPlaybackState[GaplessPlaybackState["Stopped"] = 0] = "Stopped";
    GaplessPlaybackState[GaplessPlaybackState["Buffering"] = 1] = "Buffering";
    GaplessPlaybackState[GaplessPlaybackState["Playing"] = 2] = "Playing";
    GaplessPlaybackState[GaplessPlaybackState["ReadyToSwitchToWebAudio"] = 3] = "ReadyToSwitchToWebAudio";
    GaplessPlaybackState[GaplessPlaybackState["Paused"] = 4] = "Paused";
})(GaplessPlaybackState || (GaplessPlaybackState = {}));
var GaplessPlayback = (function () {
    function GaplessPlayback() {
        this.context = new AudioContext();
        this.gainNode = this.context.createGain();
        this.gainNode.gain.value = 1;
        this.gainNode.connect(this.context.destination);
    }
    GaplessPlayback.prototype.buildTrackForUrl = function (url) {
        var _this = this;
        var t = new GaplessTrack(this.context, this.gainNode, url);
        t.onPrepareNextTrack = function () {
            _this.onNeedsNextUrl(function (nextUrl) {
                if (nextUrl != null) {
                    _this.nextTrack = _this.buildTrackForUrl(nextUrl);
                    _this.nextTrack.load();
                }
            });
        };
        t.onEnded = function () {
            var oldUrl = _this.currentTrack.url;
            if (_this.nextTrack) {
                _this.nextTrack.play();
                _this.currentTrack = _this.nextTrack;
                _this.onStarted(_this.currentTrack.url);
                _this.nextTrack = null;
            }
            else {
                _this.currentTrack = null;
            }
            _this.onEnded(oldUrl, _this.currentTrack != null);
        };
        return t;
    };
    GaplessPlayback.prototype.stateToString = function (state) {
        if (state == GaplessPlaybackState.Buffering) {
            return "buffering";
        }
        else if (state == GaplessPlaybackState.Paused) {
            return "paused";
        }
        else if (state == GaplessPlaybackState.Playing) {
            return "playing";
        }
        else if (state == GaplessPlaybackState.ReadyToSwitchToWebAudio) {
            return "ready to switch to web audio";
        }
        else if (state == GaplessPlaybackState.Stopped) {
            return "stopped";
        }
        return "unknown state";
    };
    GaplessPlayback.prototype.startUpdates = function () {
        var _this = this;
        setInterval(function () {
            if (!_this.currentTrack) {
                return;
            }
            _this.onPlaybackUpdate({
                stateDescription: _this.stateToString(_this.currentTrack.state),
                state: _this.currentTrack.state,
                url: _this.currentTrack.url,
                duration: _this.currentTrack.duration(),
                elapsed: _this.currentTrack.elapsed()
            });
        }, 3000);
    };
    GaplessPlayback.prototype.setCurrentTrack = function (url) {
        if (url != null) {
            this.currentTrack = this.buildTrackForUrl(url);
        }
    };
    GaplessPlayback.prototype.load = function (url) {
        var _this = this;
        if (url) {
            this.setCurrentTrack(url);
            this.currentTrack.load();
        }
        else if (this.currentTrack == null) {
            this.onNeedsNextUrl(function (url) {
                _this.setCurrentTrack(url);
                _this.currentTrack.load();
            });
        }
        else {
            this.currentTrack.load();
        }
    };
    GaplessPlayback.prototype.play = function (url) {
        if (url) {
            this.startUpdates();
            this.setCurrentTrack(url);
            this.currentTrack.play();
            this.onStarted(this.currentTrack.url);
        }
        else if (this.currentTrack) {
            this.startUpdates();
            this.currentTrack.play();
            this.onStarted(this.currentTrack.url);
        }
    };
    GaplessPlayback.prototype.pause = function () {
        if (this.currentTrack) {
            this.currentTrack.pause();
        }
    };
    GaplessPlayback.prototype.next = function () {
        if (this.nextTrack) {
            this.currentTrack.pause();
            this.nextTrack.play();
            this.currentTrack = this.nextTrack;
            this.nextTrack = null;
        }
    };
    GaplessPlayback.prototype.duration = function () {
        if (this.currentTrack) {
            return this.currentTrack.duration();
        }
        return -1;
    };
    GaplessPlayback.prototype.elapsed = function () {
        if (this.currentTrack) {
            return this.currentTrack.elapsed();
        }
        return -1;
    };
    GaplessPlayback.prototype.seekToPercent = function (p) {
        if (this.currentTrack) {
            return this.currentTrack.seekToPercent(p);
        }
    };
    GaplessPlayback.prototype.seekToTime = function (t) {
        if (this.currentTrack) {
            return this.currentTrack.seekToTime(t);
        }
    };
    return GaplessPlayback;
}());
var GaplessTrackSource;
(function (GaplessTrackSource) {
    GaplessTrackSource[GaplessTrackSource["HTMLAudioElement"] = 0] = "HTMLAudioElement";
    GaplessTrackSource[GaplessTrackSource["WebAudio"] = 1] = "WebAudio";
})(GaplessTrackSource || (GaplessTrackSource = {}));
var GaplessTrack = (function () {
    function GaplessTrack(context, gainNode, url) {
        this.bufferStartTime = 0;
        this.bufferStartOffset = 0;
        this.bufferStartOffsetFromHTMLAudio = 0;
        this.onPrepareNextTrack = null;
        this.onEnded = null;
        this.switchToWebAudioAt = Math.pow(2, 53) - 1; // a very large number
        this.switchingCheckInterval = -1;
        this.hasAttemptedLoad = false;
        this.context = context;
        this.gainNode = gainNode;
        this.audio = new Audio();
        this.audio.src = url;
        this.audio.controls = false;
        this.audio.preload = "auto";
        this.audio.volume = 1;
        this.audio.onerror = function (e) {
            console.log(e);
        };
        this.url = url;
        this.state = GaplessPlaybackState.Stopped;
        this.source = GaplessTrackSource.HTMLAudioElement;
    }
    GaplessTrack.prototype.getAudio = function () {
        return this.audio;
    };
    GaplessTrack.prototype.clearAudio = function () {
        this.audio = null;
    };
    GaplessTrack.prototype.setFullBuffer = function (buf) {
        this.buf = buf;
    };
    GaplessTrack.prototype.getFullBuffer = function () {
        return this.buf;
    };
    GaplessTrack.prototype.loadHead = function (cb) {
        var _this = this;
        var options = {
            method: 'HEAD'
        };
        fetch(this.url, options)
            .then(function (res) {
            if (res.redirected) {
                _this.url = res.url;
            }
            cb();
        });
    };
    GaplessTrack.prototype.loadBuffer = function (context, cb) {
        var options = {
            headers: new Headers({
                Range: "bytes=-" + 1024 * 1024
            })
        };
        var request = fetch(this.url, options)
            .then(function (res) { return res.arrayBuffer(); })
            .then(function (res) {
            return context.decodeAudioData(res, function (buffer) {
                cb(buffer);
            });
        })["catch"](function (e) { return console.log('caught fetch error', e); });
    };
    GaplessTrack.prototype.makeNewSourceNode = function () {
        var _this = this;
        var s = this.context.createBufferSource();
        s.buffer = this.getFullBuffer();
        s.connect(this.gainNode);
        s.onended = function () {
            if (_this.onEnded != null) {
                _this.onEnded();
            }
        };
        return s;
    };
    GaplessTrack.prototype.switchToWebAudio = function () {
        this.debug("switching to web audio...");
        this.currentSourceNode = this.makeNewSourceNode();
        this.bufferStartTime = this.context.currentTime;
        this.bufferStartOffsetFromHTMLAudio = this.getAudio().currentTime;
        console.log("current time %f/%f, switch at: %f (%f)", this.getAudio().currentTime, this.getAudio().duration, this.switchToWebAudioAt, this.getFullBuffer().duration);
        this.currentSourceNode.start(0, this.getAudio().currentTime - this.switchToWebAudioAt);
        this.getAudio().pause();
        this.clearAudio();
        this.source = GaplessTrackSource.WebAudio;
        this.debug("...done. Did you hear a blip!?");
        this.state = GaplessPlaybackState.Playing;
        if (this.onPrepareNextTrack != null) {
            this.onPrepareNextTrack();
        }
    };
    GaplessTrack.prototype.attemptSwitchToWebAudio = function () {
        var _this = this;
        this.switchToWebAudioAt = this.getAudio().duration - this.getFullBuffer().duration;
        // we can't switch to web audio unless we have actually played
        // the HTML5 audio for a few seconds to avoid the blip
        if (this.switchingCheckInterval == -1) {
            this.switchingCheckInterval = setInterval(function () {
                if (_this.getAudio().currentTime >= _this.switchToWebAudioAt) {
                    _this.switchToWebAudio();
                    clearInterval(_this.switchingCheckInterval);
                }
            }, 500);
        }
        console.log("got the last %f seconds of audio", this.getFullBuffer().duration);
    };
    GaplessTrack.prototype.debug = function (s) {
        console.log(this.url + ": " + s);
    };
    GaplessTrack.prototype.load = function () {
        var _this = this;
        if (!this.hasAttemptedLoad) {
            this.hasAttemptedLoad = true;
            this.debug("loading HTML5 audio...");
            this.audio.load();
            this.state = GaplessPlaybackState.Buffering;
            this.audio.addEventListener("playing", function (e) {
                if (_this.state != GaplessPlaybackState.ReadyToSwitchToWebAudio) {
                    _this.state = GaplessPlaybackState.Playing;
                }
            });
            this.audio.addEventListener("canplay", function (e) {
                _this.debug("can play HTML5 audio");
                _this.state = GaplessPlaybackState.Paused;
            });
            this.audio.addEventListener("canplaythrough", function (e) {
                _this.debug("HTML5 audio fully loaded");
                _this.loadHead(function () {
                    _this.loadBuffer(_this.context, function (buf) {
                        _this.state = GaplessPlaybackState.ReadyToSwitchToWebAudio;
                        _this.debug("audio parsed");
                        _this.setFullBuffer(buf);
                        _this.attemptSwitchToWebAudio();
                    });
                });
            });
            this.audio.addEventListener("ended", function (e) {
                if (_this.onEnded != null) {
                    _this.onEnded();
                }
            });
        }
    };
    GaplessTrack.prototype.duration = function () {
        if (this.source == GaplessTrackSource.HTMLAudioElement) {
            return this.getAudio().duration;
        }
        else {
            return this.getFullBuffer().duration;
        }
    };
    GaplessTrack.prototype.play = function () {
        var _this = this;
        if (this.state == GaplessPlaybackState.ReadyToSwitchToWebAudio) {
            this.debug("play requested with full web audio buffer. playing html5 first");
            this.getAudio().play();
            this.state = GaplessPlaybackState.Playing;
            setTimeout(function () {
                _this.attemptSwitchToWebAudio();
            }, 500);
            return;
        }
        this.load();
        if (this.source == GaplessTrackSource.HTMLAudioElement) {
            this.getAudio().play();
        }
        else {
            if (this.state == GaplessPlaybackState.Paused) {
                this.bufferStartTime = this.context.currentTime;
                this.bufferStartOffsetFromHTMLAudio = this.bufferStartOffset + this.bufferStartOffsetFromHTMLAudio;
                this.seekToTime(this.bufferStartOffset);
            }
            else {
                this.debug("huh? tried playing web audio before html5 audio because it never got to a paused state");
            }
        }
        this.state = GaplessPlaybackState.Playing;
    };
    GaplessTrack.prototype.pause = function () {
        if (this.source == GaplessTrackSource.HTMLAudioElement) {
            this.getAudio().pause();
        }
        else {
            this.bufferStartOffset += this.context.currentTime - this.bufferStartTime;
            this.currentSourceNode.onended = null;
            this.currentSourceNode.stop(0);
        }
        this.state = GaplessPlaybackState.Paused;
    };
    GaplessTrack.prototype.seekToPercent = function (p) {
        this.seekToTime(p * this.duration());
    };
    GaplessTrack.prototype.seekToTime = function (t) {
        if (this.source == GaplessTrackSource.HTMLAudioElement) {
            this.getAudio().currentTime = t;
        }
        else {
            var oldNode = this.currentSourceNode;
            this.currentSourceNode = this.makeNewSourceNode();
            this.bufferStartTime = this.context.currentTime;
            this.bufferStartOffsetFromHTMLAudio = t;
            this.currentSourceNode.start(0, t);
            oldNode.onended = null;
            oldNode.stop();
        }
    };
    GaplessTrack.prototype.elapsed = function () {
        if (this.source == GaplessTrackSource.HTMLAudioElement) {
            return this.getAudio().currentTime;
        }
        else {
            if (this.state == GaplessPlaybackState.Playing) {
                return this.context.currentTime - this.bufferStartTime + this.bufferStartOffsetFromHTMLAudio;
            }
            else {
                return this.bufferStartOffset + this.bufferStartOffsetFromHTMLAudio;
            }
        }
    };
    GaplessTrack.prototype.getState = function () {
        return this.state;
    };
    return GaplessTrack;
}());
//# sourceMappingURL=gapless.js.map