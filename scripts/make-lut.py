#!/usr/bin/env python3
"""Regenera src/cmyk-lut.mjs: una LUT CMYK→sRGB con lcms2 (PIL.ImageCms) desde un perfil ICC CMYK.
Uso: make-lut.py <perfil.icc> [pasos=13]. Illustrator usa por defecto "U.S. Web Coated (SWOP) v2"."""
import sys, json, base64, itertools
from PIL import Image, ImageCms
icc = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 13
t = ImageCms.buildTransform(ImageCms.getOpenProfile(icc), ImageCms.createProfile('sRGB'), 'CMYK', 'RGB',
  renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
vals = [round(i * 255 / (N - 1)) for i in range(N)]
pix = list(itertools.product(vals, repeat=4))
img = Image.new('CMYK', (len(pix), 1)); img.putdata(pix)
data = bytes(v for px in ImageCms.applyTransform(img, t).getdata() for v in px)
open('src/cmyk-lut.mjs', 'w').write(
  '// LUT CMYK→sRGB generada con lcms2 desde el perfil %s, %d pasos por canal,\n'
  '// intención relativa colorimétrica con compensación de punto negro. Orden: c, m, y, k (k el más rápido).\n'
  '// Regenerar: scripts/make-lut.py.\n'
  'import { fromBase64 } from \'./bytes.mjs\'\nexport const STEPS = %d\nexport const LUT = fromBase64(%s)\n' % (icc.split('/')[-1], N, N, json.dumps(base64.b64encode(data).decode())))
