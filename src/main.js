/**
 * Terminal System
 *
 * A modular terminal emulator that can:
 * - Type text with natural randomness
 * - Handle multiple lines
 * - Submit lines (like pressing Enter)
 * - Queue and execute commands sequentially
 */

import { Rabbit } from './components/Rabbit.js';
import { ParticleMorph } from './components/ParticleMorph.js';
import { TYPING_CONFIG, RABBIT_CONFIG, injectCSSVariables } from './config/animations.js';
import { injectCRTVariables, startFlicker, isMobile } from './config/crt.js';
import { PARTICLE_CONFIG } from './config/particles.js';
import rabbitSpritesheetUrl from './assets/spritesheets/RabbitAnimation_V1.png';

// Inject CSS variables from centralized config
injectCSSVariables();
injectCRTVariables();

// Get CRT container for spawning elements inside it
const crtScreen = document.getElementById('crt-screen');

// Start flicker effect
startFlicker(crtScreen);

// Alias for cleaner code
const config = TYPING_CONFIG;

// ============================================
// Terminal Class
// ============================================

/**
 * Terminal manages the DOM and provides methods for typing/output
 *
 * Class in JS is similar to C# classes - bundles data and methods.
 * 'this' refers to the instance (like 'this' in Unity MonoBehaviour)
 */
class Terminal {
  constructor(containerElement) {
    this.container = containerElement;
    this.currentLine = null;
    this.cursor = this.createCursor();

    // Build DOM structure:
    // .terminal-wrapper
    //   .terminal-history (submitted lines, grows upward)
    //   .terminal-active (current line, stays centered)
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'terminal-wrapper';

    this.history = document.createElement('div');
    this.history.className = 'terminal-history';

    this.activeContainer = document.createElement('div');
    this.activeContainer.className = 'terminal-active';

    // Order matters: with column-reverse, first child appears at bottom
    this.wrapper.appendChild(this.activeContainer);
    this.wrapper.appendChild(this.history);
    this.container.appendChild(this.wrapper);

    // Start with a fresh line
    this.newLine();
  }

  /**
   * Creates the blinking cursor element
   */
  createCursor() {
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    cursor.textContent = '█';
    return cursor;
  }

  /**
   * Exponentially ramps cursor brightness over duration (ms)
   * @param {number} duration
   * @param {number} maxBrightness - e.g. 4 = 400%
   */
  rampCursorBrightness(duration = 2500, maxBrightness = 4) {
    return new Promise(resolve => {
      const start = performance.now();

      const animate = (now) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / duration, 1);

        // Exponential curve
        // t^3 gives slow start, fast end
        const eased = Math.pow(t, 3);

        const brightness = 1 + (maxBrightness - 1) * eased;

        this.cursor.style.setProperty(
          '--cursor-brightness',
          brightness
        );

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(animate);
    });
  }


  /**
   * Creates the prompt element (the ">" symbol)
   */
  createPrompt() {
    const prompt = document.createElement('span');
    prompt.className = 'prompt';
    prompt.textContent = '>';
    return prompt;
  }

  /**
   * Creates a new line in the active container
   */
  newLine() {
    const line = document.createElement('div');
    line.className = 'terminal-line';

    // Add prompt, then cursor
    line.appendChild(this.createPrompt());
    line.appendChild(this.cursor);

    // Clear active container and add new line
    this.activeContainer.innerHTML = '';
    this.activeContainer.appendChild(line);

    this.currentLine = line;
  }

  /**
   * Adds a character to the current line (before cursor)
   *
   * insertBefore(newNode, referenceNode) - inserts newNode before referenceNode
   * document.createTextNode() - creates a plain text node (not an element)
   */
  addChar(char) {
    const textNode = document.createTextNode(char);
    this.currentLine.insertBefore(textNode, this.cursor);
  }

  /**
   * Submits current line and starts a new one
   */
  submitLine() {
    // Replace prompt with space to maintain alignment
    const oldPrompt = this.currentLine.querySelector('.prompt');
    if (oldPrompt) {
      oldPrompt.textContent = ' ';
    }

    // Remove cursor from current line before moving to history
    this.cursor.remove();

    // Move line to history (append so newest appears at bottom, closest to active)
    this.history.appendChild(this.currentLine);

    // Create new active line
    this.newLine();
  }

  /**
   * Types a string with natural timing
   */
  async type(text) {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      // Pause before space
      if (char === ' ') {
        await sleep(getRandomDelay(config.spacePause, config.variance));
      }

      // Type character
      this.addChar(char);

      // Base delay
      await sleep(getRandomDelay(config.baseSpeed, config.variance));

      // Pause after word (before space)
      if (nextChar === ' ') {
        await sleep(getRandomDelay(config.spacePause * 0.5, config.variance));
      }
    }
  }

  /**
   * Types text then submits the line (like typing + Enter)
   */
  async typeLine(text) {
    await this.type(text);
    await sleep(getRandomDelay(config.linePause, config.variance));
    this.submitLine();
    await sleep(getRandomDelay(config.linePause, config.variance));
  }

  async delayedHideCursor(delay)
  {
    await sleep(delay)
    this.hideCursor();
  }

  /**
   * Execute a sequence of commands
   *
   * commands is an array of objects: { text: string, submit: boolean }
   */
  async run(commands) {
    for (const cmd of commands) {
      if (cmd.submit) {
        await this.typeLine(cmd.text);
      } else {
        await this.type(cmd.text);
      }
    }
  }

  /**
   * Gets cursor position for spawning elements relative to cursor
   * @returns {{ x: number, y: number }}
   */
  getCursorPosition() {
    const rect = this.cursor.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.bottom,
    };
  }

  /**
   * Gets the cursor's full bounding rect (position + size).
   * Used by ParticleMorph as the source rectangle for particle scatter.
   * @returns {{ x: number, y: number, w: number, h: number }}
   */
  getCursorRect() {
    const rect = this.cursor.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    };
  }

  /**
   * Hides the terminal cursor (e.g., after spawning a sprite)
   */
  hideCursor() {
    this.cursor.style.display = 'none';
  }

  /**
   * Shows the terminal cursor
   * @param {boolean} locked - If true, stops blinking and keeps cursor visible
   */
  showCursor(locked = false) {
    this.cursor.style.display = '';

    if (locked) {
      // Stop blink animation and force full opacity
      this.cursor.style.animation = 'none';
      this.cursor.style.opacity = '1';
    } else {
      // Restore blink animation
      this.cursor.style.animation = '';
      this.cursor.style.opacity = '';
    }
  }

  /**
   * Cleans up terminal DOM elements
   */
  destroy() {
    if (this.wrapper) {
      this.wrapper.remove();
    }
  }
}

// ============================================
// Utility Functions
// ============================================

function getRandomDelay(base, varianceAmount) {
  const randomFactor = 1 + (Math.random() - 0.5) * 2 * varianceAmount;
  return Math.floor(base * randomFactor);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Preloads an image to ensure it's cached before use
 * Like preloading assets in Unity's Addressables
 */
function preloadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ============================================
// URL Parameters
// ============================================

/**
 * window.location = current page URL info (like Application.absoluteURL in Unity)
 * URLSearchParams = parses query string (?key=value&other=123)
 *
 * Example: site.com/?name=John
 * - window.location.search = "?name=John"
 * - params.get('name') = "John"
 */
const params = new URLSearchParams(window.location.search);
const username = params.get('name');  // null if not present

// ============================================
// Initialize & Run
// ============================================

const terminalElement = document.getElementById('terminal');
const terminal = new Terminal(terminalElement);

// Build name for sequence (defaults to "Neo")
const wakeUpText = username ? `Wake up, ${username}...` : 'Wake up...';

// The Matrix opening terminal sequence
const introSequence = [
  { text: wakeUpText, submit: true },
  { text: 'Follow the white rabbit.', submit: false },
];

// Track rabbit instance for cleanup
let rabbit = null;

/**
 * Transition: rabbit click → freeze → particle dissolve → white terminal → typing
 *
 * The rabbit shatters into white particles that converge into a cursor block,
 * then the DOM cursor is revealed and starts typing the introduction.
 */
async function startRabbitTransition() {
  try {
    // 1. Freeze rabbit — stop all animations, get position
    const rabbitRect = rabbit.freeze();

    // 2. Destroy old terminal text instantly
    terminal.destroy();

    // 3. Hide the rabbit DOM element (particles will represent it)
    rabbit.element.style.visibility = 'hidden';

    // 4. Set up the new terminal (same green as the first)
    const whiteTerminal = new Terminal(terminalElement);

    // 5. Measure cursor rect while it exists in layout, then hide it.
    //    The cursor flashes for 1 frame but the particle canvas covers it.
    const cursorTargetRect = whiteTerminal.getCursorRect();
    whiteTerminal.hideCursor();

    // 6. Start particle morph: rabbit sprite → cursor block
    const spriteImage = await preloadImage(rabbitSpritesheetUrl);
    const morph = new ParticleMorph(PARTICLE_CONFIG);

    await morph.start({
      source: {
        rect: rabbitRect,
        image: spriteImage,
        frame: RABBIT_CONFIG.frames.idle,
        flipped: rabbit.lastDirection === -1,
      },
      target: { rect: cursorTargetRect },
      container: crtScreen,
      color: PARTICLE_CONFIG.color,
    });

    // 7. Destroy the rabbit DOM element
    rabbit.destroy();
    rabbit = null;

    // 8. Show cursor (locked, no blink) under the canvas
    whiteTerminal.showCursor(true);

    // 9. Handoff: fade canvas, reveal DOM cursor
    await morph.handoff();
    morph.destroy();

    // 10. Start cursor blinking
    whiteTerminal.showCursor(false);
    await sleep(400);

    // 11. Type the introduction
    await whiteTerminal.type("Hi! I'm Tomás,");
    whiteTerminal.submitLine();
    await sleep(300);
    await whiteTerminal.type("Technical Artist");

  } catch (error) {
    console.error('Rabbit transition failed:', error);
  }
}

// Run sequence, then spawn rabbit
async function main() {
  try {
    // Preload rabbit spritesheet before starting
    await preloadImage(rabbitSpritesheetUrl);

    await terminal.run(introSequence);

    terminal.hideCursor();
    await sleep(500);
    terminal.showCursor(true);

    // Get cursor position and hide cursor
    const cursorPos = terminal.getCursorPosition();
    const cursorRect = terminal.getCursorRect();

    // await sleep(2500); // Wait before hiding cursor
    await terminal.rampCursorBrightness(2500, 8);

    if (isMobile()) {
      // Mobile: skip particles, use existing direct spawn + drop
      rabbit = new Rabbit();
      rabbit.spawnAndDrop(cursorPos.x, cursorPos.y, crtScreen);
      terminal.hideCursor();
    } else {
      // Desktop: particle morph — cursor shatters into particles that
      // reassemble into the rabbit shape, then hand off to DOM element
      const spriteImage = await preloadImage(rabbitSpritesheetUrl);

      const morph = new ParticleMorph(PARTICLE_CONFIG);
      const targetRect = {
        x: cursorPos.x,
        y: cursorPos.y,
        w: RABBIT_CONFIG.width,
        h: RABBIT_CONFIG.height,
      };

      terminal.delayedHideCursor(100)

      // Particles animate: scatter → drift → converge → settle
      await morph.start({
        source: { rect: cursorRect },
        target: { rect: targetRect, image: spriteImage, frame: RABBIT_CONFIG.frames.spawnStart, flipped: true },
        container: crtScreen,
      });

      // Place the real DOM rabbit underneath the canvas (hidden)
      rabbit = new Rabbit();
      rabbit.spawnSilent(cursorPos.x, cursorPos.y, crtScreen);

      // Fade canvas out, revealing DOM rabbit underneath
      await morph.handoff();
      morph.destroy();

      // Now drop the rabbit to the bottom
      rabbit.startDrop();
    }

    // Set up rabbit click → white terminal transition
    rabbit.enableMouseReaction(undefined, {
      onClick: () => startRabbitTransition(),
    });

  } catch (error) {
    console.error('Failed to initialize terminal:', error);
    // Fallback: show error message to user
    const terminalEl = document.getElementById('terminal');
    if (terminalEl) {
      terminalEl.innerHTML = `
        <div style="color: var(--terminal-green, #8fff8f); padding: 2rem; font-family: monospace;">
          > System error. Please refresh the page.
        </div>
      `;
    }
  }
}

main();
