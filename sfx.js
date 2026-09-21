// ============================================================
//  sfx.js — Web Audio API Sound Effects Synthesizer
//  + File-based SFX (MP3) with synthesized fallback
// ============================================================

// ── File-based SFX paths (relative to index.html) ──
const SFX_FILE_MAP = {
    ui_click: 'assets/sounds/button_sound.mp3',
    move:     'assets/sounds/chess_move.mp3',
};

const sfxFileCache = {};

// Preload every mapped file once.
// Called automatically from the DOMContentLoaded handler at the bottom.
function preloadSfxFiles() {
    for (const [type, path] of Object.entries(SFX_FILE_MAP)) {
        if (!sfxFileCache[type]) {
            const audio = new Audio(path);
            audio.preload = 'auto';
            audio.volume = (typeof gameSettings !== 'undefined' && gameSettings && gameSettings.sfxVolume != null)
                ? gameSettings.sfxVolume / 100
                : 0.8;
            sfxFileCache[type] = audio;
        }
    }
}

// Try to play an MP3 for the given SFX type.
// Returns true if a file exists and playback was attempted.
function playSfxFile(type) {
    const cached = sfxFileCache[type];
    if (!cached) return false;

    // Clone so overlapping sounds don't cut each other off
    const clone = cached.cloneNode();
    clone.volume = (typeof gameSettings !== 'undefined' && gameSettings && gameSettings.sfxVolume != null)
        ? gameSettings.sfxVolume / 100
        : 0.8;

    // Browsers may block autoplay before a user gesture — swallow the error
    clone.play().catch(() => {});
    return true;
}

// ── Synthesized SFX (used as fallback when no MP3 is available) ──
let sfxCtx = null;
let sfxMasterGain = null;

function initSFX() {
    if (!sfxCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        sfxCtx = new Ctx();
        sfxMasterGain = sfxCtx.createGain();
        sfxMasterGain.connect(sfxCtx.destination);
    }
    // Browsers block audio before user interaction. Resume on first use.
    if (sfxCtx.state === 'suspended') {
        sfxCtx.resume();
    }
}

// Call this whenever the volume slider changes
function updateSFXVolume() {
    const vol = (typeof gameSettings !== 'undefined' && gameSettings && gameSettings.sfxVolume != null)
        ? gameSettings.sfxVolume / 100
        : 0.8;

    // Update the Web Audio master gain (for synthesized sounds)
    if (sfxMasterGain && sfxCtx) {
        sfxMasterGain.gain.setValueAtTime(vol, sfxCtx.currentTime);
    }
    // Update every cached file audio element
    for (const audio of Object.values(sfxFileCache)) {
        audio.volume = vol;
    }
}

// Main function to play a sound
function playSFX(type) {
    if (typeof gameSettings !== 'undefined' && gameSettings && gameSettings.sfxVolume != null) {
        if (gameSettings.sfxVolume <= 0) return;
    }

    // ★ Try file-based sound first
    if (playSfxFile(type)) return;

    // ── Fall back to synthesized sound ──
    initSFX();
    if (!sfxCtx) return;

    updateSFXVolume();

    const now = sfxCtx.currentTime;

    switch (type) {
        case 'ui_click':
            // Short high-pitched blip
            playTone('sine', 800, 300, 0.08, 0.3, now);
            break;

        case 'move':
            // Low wooden thud
            playTone('triangle', 150, 50, 0.1, 0.5, now);
            break;

        case 'capture':
            // Harsher, louder thud
            playTone('square', 200, 80, 0.15, 0.4, now);
            break;

        case 'skill':
            // Magical zap (sweeping up)
            playTone('sawtooth', 300, 1200, 0.2, 0.3, now);
            break;

        case 'explosion':
            // Noise burst with lowpass filter
            playNoise(0.4, 1000, 100, 0.6, now);
            break;

        case 'heal':
            // Gentle rising chime
            playTone('sine', 400, 800, 0.3, 0.3, now);
            playTone('sine', 600, 1000, 0.3, 0.2, now);
            break;

        case 'gameover':
            // Descending sad tone
            playTone('sine', 400, 150, 0.8, 0.5, now);
            break;

        case 'victory':
            // Ascending happy arpeggio
            playTone('square', 400, 600, 0.15, 0.3, now);
            playTone('square', 600, 800, 0.15, 0.3, now + 0.15);
            playTone('square', 800, 1200, 0.3, 0.3, now + 0.3);
            break;
    }
}

// Helper: Synthesize a pitched tone
function playTone(waveType, startFreq, endFreq, duration, volume, startTime) {
    const osc = sfxCtx.createOscillator();
    const gain = sfxCtx.createGain();

    osc.type = waveType;
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);

    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    osc.connect(gain);
    gain.connect(sfxMasterGain);

    osc.start(startTime);
    osc.stop(startTime + duration);
}

// Helper: Synthesize white noise (for explosions)
function playNoise(duration, startFreq, endFreq, volume, startTime) {
    const bufferSize = sfxCtx.sampleRate * duration;
    const buffer = sfxCtx.createBuffer(1, bufferSize, sfxCtx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1; // White noise
    }

    const noise = sfxCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = sfxCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(startFreq, startTime);
    filter.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);

    const gain = sfxCtx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(sfxMasterGain);

    noise.start(startTime);
    noise.stop(startTime + duration);
}

// ============================================================
//  GLOBAL UI HOOKS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

    // ★ Preload the file-based SFX now that the DOM is ready
    preloadSfxFiles();

    // Automatically catch all button clicks for the click sound
    document.body.addEventListener('click', (e) => {
        // Find if the clicked element or its parent is a button
        const btn = e.target.closest('button, .btn, .mode-btn, .time-btn, .promotion-btn');
        if (btn && !btn.disabled) {
            playSFX('ui_click');
        }
    });

    // Hook into the settings slider to update volume in real-time
    const sfxSlider = document.getElementById('sfxVolumeSlider');
    if (sfxSlider) {
        sfxSlider.addEventListener('input', () => {
            // main.js already updates `gameSettings.sfxVolume`
            updateSFXVolume();
        });
    }
});