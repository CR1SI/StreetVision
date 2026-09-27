import{b as u,u as r,a as c,r as i,F as n}from"./format-BPloVTmF.js";/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=u("Plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]);function d(){const e=r(s=>c.utilities({signal:s}),[]),t=i.useMemo(()=>e.data??[],[e.data]),a=i.useMemo(()=>n(t.map(s=>s.utility_id)),[t]),o=i.useMemo(()=>Object.fromEntries(t.map(s=>[s.utility_id,s.name||s.utility_id])),[t]);return{...e,list:t,colors:a,names:o}}export{m as P,d as u};
