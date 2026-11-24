// Skyway app · if the app hasn't started after 8 seconds (a script blocker,
// a missing file, a very old browser), say so instead of showing a spinner forever.
// When the app starts it replaces this message, so the timer finds nothing to show.
setTimeout(function () {
  var help = document.getElementById('boot-help');
  if (help) help.hidden = false;
}, 8000);
