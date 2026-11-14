import sharp from 'sharp';
const rows=[['hall-yard','走廊返回小院'],['gallery-yard','收藏展廊返回小院'],['study-yard','书房返回小院'],['blank-yard','空白房间返回小院']],fractions=['000','025','050','075','100'];
const composite=[];
for(let row=0;row<rows.length;row++){
 const [prefix,label]=rows[row];const svg=Buffer.from(`<svg width="1600" height="36"><rect width="1600" height="36" fill="#f4f4ed"/><text x="8" y="25" fill="#29362e" font-family="Microsoft YaHei" font-size="18">${label}　·　0% → 25% → 50% → 75% → 100%</text></svg>`);composite.push({input:svg,left:0,top:row*236});
 for(let col=0;col<fractions.length;col++)composite.push({input:await sharp(`.qa/realistic/${prefix}-${fractions[col]}.png`).resize(320,200).toBuffer(),left:col*320,top:row*236+36});
}
await sharp({create:{width:1600,height:944,channels:3,background:'#f4f4ed'}}).composite(composite).png().toFile('.qa/realistic/return-keyframes.png');
