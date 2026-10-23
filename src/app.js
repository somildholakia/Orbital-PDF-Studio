(function(){
"use strict";
var $=function(s,r){return (r||document).querySelector(s)}, $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var P=window.PDFLib,PDFJS=window.pdfjsLib,ZIP=window.JSZip;
var files=[],images=[],tool="merge",lastBlob=null,lastName="orbital-export.pdf",lastURL="",toastTimer=null;
var tools={
merge:{title:"Merge PDFs",desc:"Combine PDFs in your chosen sequence, with optional page sizing and a blank separator.",icon:"↔",tag:"COMBINE FILES",button:"Merge PDFs",intro:"Arrange the file queue, choose how page sizes should behave, and export one document."},
split:{title:"Split PDF",desc:"Extract selected pages, or split a document into smaller files.",icon:"✂",tag:"PICK YOUR PAGES",button:"Export selected pages",intro:"Select page ranges and decide whether to create one PDF, one file per page, or batches."},
organize:{title:"Organize pages",desc:"Set your own page order, remove pages, and rotate every exported page.",icon:"▤",tag:"MAKE IT FLOW",button:"Export organized PDF",intro:"Use page numbers like 3,1,2,4-6 to reorder pages. Removed pages are excluded from the export."},
annotate:{title:"Annotate PDF",desc:"Add a visible text note with custom color, size, opacity and placement.",icon:"✎",tag:"MARK IT UP",button:"Export annotated PDF",intro:"Add a flattened note overlay to selected pages. Existing PDF text is not rewritten."},
watermark:{title:"Watermark PDF",desc:"Style text watermarks and page numbers independently.",icon:"◈",tag:"FINISH THE DETAILS",button:"Export watermarked PDF",intro:"Tune opacity, angle, size, placement, and numbering before exporting."},
images:{title:"Images to PDF",desc:"Arrange images into a PDF with paper size, orientation, margins and quality settings.",icon:"▧",tag:"CHANGE FORMATS",button:"Create image PDF",intro:"Choose a paper size and image fit. Image order below becomes the PDF page order."},
"pdf-images":{title:"PDF to PNG",desc:"Convert chosen PDF pages to high-quality PNG images in a ZIP file.",icon:"▦",tag:"EXPORT IMAGES",button:"Create PNG ZIP",intro:"Choose the page range and rendering scale. Each page is saved as a separate PNG."},
extract:{title:"Extract text",desc:"Download the selectable text layer from chosen PDF pages.",icon:"¶",tag:"GET THE WORDS",button:"Extract text to TXT",intro:"This reads existing text layers. Scanned pages require OCR, which is not included."},
optimize:{title:"Optimize PDF",desc:"Rewrite the PDF structure, with optional metadata clearing and size comparison.",icon:"⌁",tag:"LEANER FILES",button:"Optimize PDF",intro:"This can reduce structural overhead but does not recompress embedded images."}
};
function escapeHtml(v){return String(v==null?"":v).replace(/[&<>"]/g,function(c){return({"&":"&","<":"<",">":">",'"':"""}[c])})}
function bytes(n){if(n<1024)return n+" B";if(n<1048576)return(n/1024).toFixed(1)+" KB";return(n/1048576).toFixed(2)+" MB"}
function note(message,kind){var el=$("#status");if(el){el.textContent=message;el.dataset.kind=kind||""}var t=$("#toast");if(t){t.textContent=message;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.classList.remove("show")},3200)}}
function getOpt(key){var el=$('[data-opt="'+key+'"]');if(!el)return "";if(el.type==="checkbox")return el.checked;if(el.type==="range"||el.type==="number")return el.value;return el.value}
function setDefaultOpt(key,value){var el=$('[data-opt="'+key+'"]');if(el){if(el.type==="checkbox")el.checked=!!value;else el.value=value}}
function field(label,key,kind,value,opts,help,full){var c=' class="control" data-opt="'+key+'"';var wrap='