/**
 * sampleWorker — off-thread sprite cell sampler
 *
 * Receives an ImageBitmap for a single spritesheet frame, draws it onto an
 * OffscreenCanvas, reads pixel data, then groups pixels into NxN cells.
 * Returns the array of opaque cells with averaged color.
 *
 * Runs entirely off the main thread — no impact on frame budget.
 *
 * Message in:  { bitmap, width, height, cellSize, frameOffset }
 *   bitmap      — ImageBitmap (transferred, zero-copy)
 *   width/height — frame dimensions in px
 *   cellSize    — NxN px per particle cell
 *   frameOffset — passed back verbatim so the caller can key the cache
 *
 * Message out: { cells, frameOffset }
 *   cells       — Array<{ localX, localY, r, g, b, a }>
 */
self.onmessage = ({ data: { bitmap, width, height, cellSize, frameOffset } }) => {
  const canvas = new OffscreenCanvas(width, height);
  // willReadFrequently keeps pixel data CPU-side, avoiding GPU readback cost
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close(); // release GPU resource immediately

  const { data: pixels } = ctx.getImageData(0, 0, width, height);

  const cells = [];
  const cellsX = Math.ceil(width / cellSize);
  const cellsY = Math.ceil(height / cellSize);

  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      let hasOpaque = false;
      let totalR = 0, totalG = 0, totalB = 0, count = 0;

      for (let py = 0; py < cellSize; py++) {
        for (let px = 0; px < cellSize; px++) {
          const pixelX = cx * cellSize + px;
          const pixelY = cy * cellSize + py;
          if (pixelX >= width || pixelY >= height) continue;

          const i = (pixelY * width + pixelX) * 4;
          if (pixels[i + 3] > 0) {
            hasOpaque = true;
            totalR += pixels[i];
            totalG += pixels[i + 1];
            totalB += pixels[i + 2];
            count++;
          }
        }
      }

      if (hasOpaque) {
        cells.push({
          localX: cx * cellSize,
          localY: cy * cellSize,
          r: Math.round(totalR / count),
          g: Math.round(totalG / count),
          b: Math.round(totalB / count),
          a: 255,
        });
      }
    }
  }

  self.postMessage({ cells, frameOffset });
};
