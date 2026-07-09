import QRCode from 'qrcode';
import sharp from 'sharp';

async function test() {
  const qrc = QRCode.create('upi://pay?pa=test@upi&pn=Test&am=500', { errorCorrectionLevel: 'H' });
  const size = qrc.modules.size;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="-2 -2 ${size + 4} ${size + 4}">
    <rect width="100%" height="100%" x="-2" y="-2" fill="white"/>`;
  
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qrc.modules.get(r, c)) {
        svg += `<circle cx="${c + 0.5}" cy="${r + 0.5}" r="0.45" fill="black"/>`;
      }
    }
  }
  svg += '</svg>';
  
  await sharp(Buffer.from(svg)).png().toFile('D:/gmail payment gateway/test_styled.png');
  console.log('Done');
}

test();
