import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeResizeDimensions,
  PHOTO_MAX_EDGE,
  resizeImageToJpeg,
} from '../js/catalog/photo.js';

describe('photo resize', () => {
  it('leaves small images unchanged', () => {
    assert.deepEqual(computeResizeDimensions(400, 300), {
      width: 400,
      height: 300,
    });
  });

  it('scales longest edge to max', () => {
    assert.deepEqual(computeResizeDimensions(1600, 1200, PHOTO_MAX_EDGE), {
      width: 800,
      height: 600,
    });
    assert.deepEqual(computeResizeDimensions(900, 1800, 800), {
      width: 400,
      height: 800,
    });
  });

  it('encodes JPEG via injected canvas mocks', async () => {
    const fakeBitmap = { width: 1000, height: 500, close() {} };
    const drawn = [];
    const fakeCtx = {
      drawImage(img, x, y, w, h) {
        drawn.push({ w, h });
      },
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext() {
        return fakeCtx;
      },
      toBlob(cb, type, quality) {
        assert.equal(type, 'image/jpeg');
        assert.equal(quality, 0.7);
        cb(new Blob([Uint8Array.from([0xff, 0xd8, 0xff])], { type }));
      },
    };
    const result = await resizeImageToJpeg(new Blob(['x']), {
      createImageBitmap: async () => fakeBitmap,
      document: {
        createElement(tag) {
          assert.equal(tag, 'canvas');
          return fakeCanvas;
        },
      },
    });
    assert.equal(result.extension, 'jpeg');
    assert.ok(result.data instanceof Uint8Array);
    assert.equal(result.data[0], 0xff);
    assert.deepEqual(drawn[0], { w: 800, h: 400 });
    assert.equal(fakeCanvas.width, 800);
    assert.equal(fakeCanvas.height, 400);
  });
});
