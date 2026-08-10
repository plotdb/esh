 (function() { function pug_attr(t,e,n,r){if(!1===e||null==e||!e&&("class"===t||"style"===t))return"";if(!0===e)return" "+(r?t:t+'="'+t+'"');var f=typeof e;return"object"!==f&&"function"!==f||"function"!=typeof e.toJSON||(e=e.toJSON()),"string"==typeof e||(e=JSON.stringify(e),n||-1===e.indexOf('"'))?(n&&(e=pug_escape(e))," "+t+'="'+e+'"'):" "+t+"='"+e.replace(/'/g,"&#39;")+"'"}
function pug_escape(e){var a=""+e,t=pug_match_html.exec(a);if(!t)return e;var r,c,n,s="";for(r=t.index,c=0;r<a.length;r++){switch(a.charCodeAt(r)){case 34:n="&quot;";break;case 38:n="&amp;";break;case 60:n="&lt;";break;case 62:n="&gt;";break;default:continue}c!==r&&(s+=a.substring(c,r)),c=r+1,s+=n}return c!==r?s+a.substring(c,r):s}
var pug_match_html=/["&<>]/;function template(locals) {var pug_html = "", pug_mixins = {}, pug_interp;;
    var locals_for_with = (locals || {});
    
    (function (libLoader, version) {
      pug_html = pug_html + "\u003C!DOCTYPE html\u003E";
if(!libLoader) {
  libLoader = {
    js: {url: {}},
    css: {url: {}},
    root: function(r) { libLoader._r = r; },
    _r: "/assets/lib",
    _v: "",
    version: function(v) { libLoader._v = (v ? "?v=" + v : ""); }
  }
  if(version) { libLoader.version(version); }
}























































































pug_html = pug_html + "\u003Chtml lang=\"en\"\u003E\u003Chead\u003E\u003Cmeta charset=\"utf-8\"\u003E\u003Cmeta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"\u003E\u003Ctitle\u003E@plotdb\u002Fesh — embeddable shell runtime\u003C\u002Ftitle\u003E\u003Cstyle type=\"text\u002Fcss\"\u003Ebody{font-family:monospace;margin:2rem;background:#1e1e2e;color:#cdd6f4}.case{margin:.5rem 0;padding:.4rem .7rem;background:#313244;border-radius:6px}.cmd{color:#89b4fa}.out{white-space:pre-wrap}.pass{color:#a6e3a1}.fail{color:#f38ba8}\u003C\u002Fstyle\u003E\u003C\u002Fhead\u003E\u003Cbody\u003E\u003Ch3\u003E@plotdb\u002Fesh — embeddable shell runtime (window.esh, IIFE build)\u003C\u002Fh3\u003E\u003Cdiv id=\"summary\"\u003E\u003C\u002Fdiv\u003E\u003Cdiv id=\"out\"\u003E\u003C\u002Fdiv\u003E\u003Cscript src=\"\u002Fassets\u002Fesh\u002Fesh.iife.js\"\u003E\u003C\u002Fscript\u003E\u003Cscript\u003Eesh.createShell().then(function(e){var n,t,s,r,d,o,c,l,i,m,a,h,u;n=esh.fs;n.mkdirSync(\"\u002Fhome\u002Fweb\u002Fsrc\",{recursive:true});n.writeFileSync(\"\u002Fhome\u002Fweb\u002FREADME.md\",\"# demo\\nfind the needle here\\n\");n.writeFileSync(\"\u002Fhome\u002Fweb\u002Fsrc\u002Fa.js\",'console.log(\"needle\");\\n');n.writeFileSync(\"\u002Fhome\u002Fweb\u002Fnums.txt\",\"10\\n2\\n33\\n4\\n\");e.run(\"cd \u002Fhome\u002Fweb\");t=[[\"ls\",\"README.md\\nnums.txt\\nsrc\"],[\"cat README.md | grep needle\",\"find the needle here\"],[\"sort -n nums.txt | head -n 2\",\"2\\n4\"],[\"i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done\",\"0\\n1\\n2\"],[\"greet() { echo hi $1; }; greet pug\",\"hi pug\"]];s=0;r=document.getElementById(\"out\");for(d=0,o=t.length;d\u003Co;++d){c=t[d],l=c[0],i=c[1];m=e.run(l);a=(m.stdout||\"\").replace(\u002F\\n+$\u002F,\"\");h=a===i;if(h){s+=1}u=document.createElement(\"div\");u.className=\"case\";u.innerHTML='\u003Cspan class=\"'+(h?'pass\"\u003E✔':'fail\"\u003E✘')+'\u003C\u002Fspan\u003E \u003Cspan class=\"cmd\"\u003E\u003C\u002Fspan\u003E\u003Cdiv class=\"out\"\u003E\u003C\u002Fdiv\u003E';u.querySelector(\".cmd\").textContent=\" $ \"+l;u.querySelector(\".out\").textContent=h?a:\"got: \"+a+\"\\nwant: \"+i;r.appendChild(u)}document.getElementById(\"summary\").textContent=s+\" \u002F \"+t.length+\" passed\";return window.sh=e});\u003C\u002Fscript\u003E\u003C\u002Fbody\u003E\u003C\u002Fhtml\u003E";
    }.call(this, "libLoader" in locals_for_with ?
        locals_for_with.libLoader :
        typeof libLoader !== 'undefined' ? libLoader : undefined, "version" in locals_for_with ?
        locals_for_with.version :
        typeof version !== 'undefined' ? version : undefined));
    ;;return pug_html;}; module.exports = template; })() 