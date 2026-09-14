#!/usr/bin/env node
// Ship OCR/PDF runtimes and language data from locked packages. Drawings never
// leave the browser, including during text recognition.
import {copyFile,cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const ocr=new URL('public/spatial-ocr/',root),pdf=new URL('public/spatial-pdf/',root);
await mkdir(ocr,{recursive:true});
await mkdir(pdf,{recursive:true});
await mkdir(new URL('public/licenses/',root),{recursive:true});
await copyFile(new URL('node_modules/three/LICENSE',root),new URL('public/licenses/Three-MIT.txt',root));
await copyFile(new URL('node_modules/dompurify/LICENSE',root),new URL('public/licenses/DOMPurify.txt',root));
const files=[
  ['node_modules/tesseract.js/dist/worker.min.js','worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm','tesseract-core-simd-lstm.wasm'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz','eng.traineddata.gz'],
];
const manifest={source:'Locked npm packages; see accompanying licence notices',files:[]};
for(const [from,to] of files){
  const source=new URL(from,root),destination=new URL(to,ocr);
  await copyFile(source,destination);
  const data=await readFile(destination);
  manifest.files.push({file:to,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
for(const name of ['wasm','standard_fonts','cmaps'])await cp(new URL(`node_modules/pdfjs-dist/${name}`,root),new URL(name,pdf),{recursive:true});
await copyFile(new URL('node_modules/tesseract.js/LICENSE.md',root),new URL('LICENSE-tesseract.txt',ocr));
await copyFile(new URL('node_modules/tesseract.js-core/LICENSE',root),new URL('LICENSE-core.txt',ocr));
await copyFile(new URL('public/licenses/Tesseract-traineddata-Apache-2.0.txt',root),new URL('LICENSE-traineddata.txt',ocr));
await copyFile(new URL('public/licenses/Tesseract-traineddata-NOTICE.txt',root),new URL('NOTICE-traineddata.txt',ocr));
await copyFile(new URL('node_modules/pdfjs-dist/LICENSE',root),new URL('LICENSE-pdfjs.txt',pdf));
await writeFile(new URL('manifest.json',ocr),JSON.stringify(manifest,null,2)+'\n');
console.log('Prepared same-origin OCR and PDF runtimes from locked dependencies.');
