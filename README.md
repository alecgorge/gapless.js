# gapless.js

Gapless audio playback using HTMLAudioElement and the Web Audio API

## example code

```html
<!DOCTYPE html>
<html>
<head lang="en">
  <meta charset="UTF-8">
  <title></title>
  <script type="text/javascript" src="gapless.js">
  </script>
  <script type="text/javascript">
    var urls = [
      "http://phish.in/audio/000/012/321/12321.mp3",
      "http://phish.in/audio/000/012/322/12322.mp3",
      "http://phish.in/audio/000/012/323/12323.mp3",
      "http://phish.in/audio/000/012/324/12324.mp3"
    ];

    window.t = new GaplessPlayback();

    var currentIndex = 0;
    var nextIndex = 1;

    t.onNeedsNextUrl = function(cb) {
      console.log("needs next %d", nextIndex);
      cb(urls[nextIndex]);
    };

    // can be called more than once (after each pause, for example)
    t.onStarted = function(url) {
      console.log("started " + url);
    };

    // TODO: add UI needs redraw event (progress, play/pause, etc)

    t.onEnded = function(playedUrl, hasNext) {
      console.log("ended: %d %s", currentIndex, playedUrl);
      currentIndex = (currentIndex + 1) % urls.length;
      nextIndex = (currentIndex + 1) % urls.length;
    };

    t.onPlaybackUpdate = function(update) {
      console.log(update);
    };

    t.load(urls[0]);

    function go() {
      t.play();
    }
  </script>
</head>
<body>
<button onclick="go();">Go!</button>
<button onclick="t.seekToPercent(0.97);">Seek to 97%!</button>
</body>
</html>
```
