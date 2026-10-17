import { nativeImage } from 'electron'
import type { ImageOps } from './prepare'

export function nativeImageOps(): ImageOps {
  return {
    size: (png) => nativeImage.createFromBuffer(png).getSize(),
    resize: (png, width, height) =>
      nativeImage.createFromBuffer(png).resize({ width, height, quality: 'good' }).toPNG(),
    toJpeg: (png, quality) => nativeImage.createFromBuffer(png).toJPEG(quality)
  }
}
