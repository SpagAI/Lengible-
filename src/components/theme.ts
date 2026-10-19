// Theme and sidebar preferences live in localStorage and are applied by a tiny script
// before the page paints, so there is no flash of the wrong colours.
export type ThemePref = "system" | "light" | "dark";

export const preferenceScript = `(function(){try{
var d=document.documentElement,t=localStorage.getItem('theme')||'system';
var m=window.matchMedia('(prefers-color-scheme: dark)');
function apply(){d.dataset.theme=t==='system'?(m.matches?'system-dark':'system-light'):t;}
apply();m.addEventListener('change',function(){t=localStorage.getItem('theme')||'system';apply();});
if(localStorage.getItem('sidebar')==='collapsed')d.dataset.sidebar='collapsed';
}catch(e){}})();`;

export function applyTheme(pref: ThemePref) {
  try {
    localStorage.setItem("theme", pref);
  } catch {}
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = pref === "system" ? (dark ? "system-dark" : "system-light") : pref;
}

export function readTheme(): ThemePref {
  try {
    return (localStorage.getItem("theme") as ThemePref) || "system";
  } catch {
    return "system";
  }
}

export function setSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem("sidebar", collapsed ? "collapsed" : "open");
  } catch {}
  if (collapsed) document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
}
