/**
 * Custom video controls for audio-bearing pieces (play/pause, seek, mute).
 *
 * The native browser chrome would clash with the CRT aesthetic, so this builds
 * a minimal control bar pinned to the bottom of a positioned container and
 * reveals it on hover (mouse) or tap (touch). Think of it as a HUD overlay
 * anchored to the media's screen-space rect.
 *
 * Lifecycle mirrors the splat viewer: attach on mount, call the returned
 * destroy() before the video is swapped/hidden/returned to the grid.
 * destroy() unconditionally re-mutes the video — that single rule is what
 * guarantees "videos always start muted", because every navigation path
 * (close, prev/next, gallery swap, deck doc close) routes through it before
 * the video is reused or re-shown.
 *
 * ── SECURITY CONTRACT ─────────────────────────────────────────────────────
 * The SVG constants below are assigned to `innerHTML`. That is safe ONLY
 * because every value is a literal string constant committed in this file
 * and reviewed as source code (same contract as src/config/icons.js).
 * DO NOT concatenate user input, URLs, or runtime data into these strings.
 * ─────────────────────────────────────────────────────────────────────────
 */

const SVG_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 4l14 8-14 8z"/></svg>`;
const SVG_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`;
const SVG_SOUND_ON = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 8.5a4.5 4.5 0 010 7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18.5 6a8 8 0 010 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
const SVG_SOUND_OFF = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

const AUTO_HIDE_MS = 3000;

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Attaches a control bar for `video` inside `container` (must be positioned —
 * the bar is position:absolute pinned to its bottom edge).
 *
 * @param {HTMLVideoElement} video
 * @param {HTMLElement} container - positioned ancestor the bar is appended to
 * @param {{ reveal?: 'hover' | 'tap' | 'auto' }} opts - how the bar appears.
 *   'auto' resolves by pointer capability ('hover' on mouse, 'tap' on touch).
 * @returns {{ destroy(): void }}
 */
export function attachVideoControls(video, container, opts = {}) {
  const reveal = (opts.reveal ?? 'auto') === 'auto'
    ? (window.matchMedia('(hover: hover)').matches ? 'hover' : 'tap')
    : opts.reveal;

  container.classList.add('vc-host');

  const bar = document.createElement('div');
  bar.className = 'video-controls';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'vc-btn vc-play';

  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'vc-seek';
  seek.min = '0';
  seek.step = 'any';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Seek');

  const time = document.createElement('span');
  time.className = 'vc-time';
  time.textContent = '0:00 / 0:00';

  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'vc-btn vc-mute';

  bar.append(playBtn, seek, time, muteBtn);
  container.appendChild(bar);

  // True while the user is dragging the thumb — timeupdate must not fight the
  // drag by snapping the thumb back to playback position mid-scrub.
  let scrubbing = false;
  let hideTimer = null;

  // ---- state → UI sync ----

  function syncPlayIcon() {
    const paused = video.paused;
    playBtn.innerHTML = paused ? SVG_PLAY : SVG_PAUSE;
    playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    // Keep the bar visible while paused — a frozen frame with no way to
    // resume is a dead end (hover may have already moved off the media).
    bar.classList.toggle('vc-paused', paused);
  }

  function syncMuteIcon() {
    muteBtn.innerHTML = video.muted ? SVG_SOUND_OFF : SVG_SOUND_ON;
    muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
  }

  function syncDuration() {
    if (Number.isFinite(video.duration)) seek.max = String(video.duration);
  }

  function syncProgress() {
    if (scrubbing) return;
    seek.value = String(video.currentTime);
    const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    seek.style.setProperty('--vc-progress', `${pct}%`);
    time.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  }

  // ---- handlers (named so destroy can remove them) ----

  // One shield for every parent click behavior: the detail view's
  // click-to-fullscreen, tap-to-toggle on the container, deck/mobile swipe.
  const onBarClick = (e) => e.stopPropagation();
  const onBarPointerDown = (e) => e.stopPropagation();

  const onPlayClick = () => { video.paused ? video.play() : video.pause(); };
  const onMuteClick = () => { video.muted = !video.muted; };
  const onSeekInput = () => {
    video.currentTime = Number(seek.value);
    const pct = video.duration ? (Number(seek.value) / video.duration) * 100 : 0;
    seek.style.setProperty('--vc-progress', `${pct}%`);
    time.textContent = `${formatTime(Number(seek.value))} / ${formatTime(video.duration)}`;
  };
  const onSeekPointerDown = () => { scrubbing = true; };
  const onWindowPointerUp = () => { scrubbing = false; };

  // ---- tap reveal (touch) ----

  // Tapping the media toggles the bar; it auto-hides after a few seconds of
  // no interaction (suspended while paused — see syncPlayIcon rationale).
  function scheduleHide() {
    clearTimeout(hideTimer);
    if (video.paused) return;
    hideTimer = setTimeout(() => bar.classList.remove('vc-visible'), AUTO_HIDE_MS);
  }
  const onContainerTap = () => {
    bar.classList.toggle('vc-visible');
    if (bar.classList.contains('vc-visible')) scheduleHide();
  };
  const onBarInteract = () => scheduleHide();

  // ---- wiring ----

  bar.addEventListener('click', onBarClick);
  bar.addEventListener('pointerdown', onBarPointerDown);
  playBtn.addEventListener('click', onPlayClick);
  muteBtn.addEventListener('click', onMuteClick);
  seek.addEventListener('input', onSeekInput);
  seek.addEventListener('pointerdown', onSeekPointerDown);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerUp);

  video.addEventListener('play', syncPlayIcon);
  video.addEventListener('pause', syncPlayIcon);
  video.addEventListener('volumechange', syncMuteIcon);
  video.addEventListener('loadedmetadata', syncDuration);
  video.addEventListener('timeupdate', syncProgress);

  if (reveal === 'tap') {
    container.addEventListener('click', onContainerTap);
    bar.addEventListener('pointerdown', onBarInteract);
  }

  // The detail video has usually been playing since the grid, so metadata is
  // already in — the loadedmetadata event won't fire again on this element.
  if (video.readyState >= 1) syncDuration();
  syncPlayIcon();
  syncMuteIcon();
  syncProgress();

  return {
    destroy() {
      clearTimeout(hideTimer);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
      video.removeEventListener('play', syncPlayIcon);
      video.removeEventListener('pause', syncPlayIcon);
      video.removeEventListener('volumechange', syncMuteIcon);
      video.removeEventListener('loadedmetadata', syncDuration);
      video.removeEventListener('timeupdate', syncProgress);
      if (reveal === 'tap') container.removeEventListener('click', onContainerTap);
      bar.remove();
      container.classList.remove('vc-host');
      // Load-bearing: the deck doc keeps its video mounted (and audible!)
      // behind the closed overlay; every other path is about to discard the
      // element anyway. Unmute must never outlive the controls.
      video.muted = true;
    },
  };
}
