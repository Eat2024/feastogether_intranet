"""以固定 Noto 來源產生浮水印專用靜態 TTF；依賴 fonttools==4.60.2。"""
from pathlib import Path
from urllib.request import urlopen
from io import BytesIO
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

SOURCE = 'https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/Subset/NotoSansTC-VF.ttf'
font = instantiateVariableFont(TTFont(BytesIO(urlopen(SOURCE).read())), {'wght': 500}, inplace=True)
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(text='饗賓集團 內部文件 請勿外流')
subsetter.subset(font)
for record in font['name'].names:
    if record.nameID in (1, 4, 6, 16):
        name = 'EsignWatermarkTC-Medium' if record.nameID == 6 else 'Esign Watermark TC Medium'
        record.string = name.encode(record.getEncoding())
font.recalcTimestamp = False
font.save(Path(__file__).with_name('EsignWatermarkTC-Medium.ttf'))
