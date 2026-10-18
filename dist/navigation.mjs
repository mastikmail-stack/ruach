const coordinate=p=>`${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
export function navigationLinks(points) {
  if(points.length<2||points.some(p=>!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon))) return null;
  const origin=points[0],destination=points.at(-1),stops=points.slice(1,-1);
  const google=new URL('https://www.google.com/maps/dir/');
  google.search=new URLSearchParams({api:'1',origin:coordinate(origin),destination:coordinate(destination),travelmode:'driving'});
  if(stops.length)google.searchParams.set('waypoints',stops.map(coordinate).join('|'));
  const waze=new URL('https://waze.com/ul');
  waze.search=new URLSearchParams({ll:coordinate(destination),navigate:'yes',vehicle_type:'motorcycle',utm_source:'ruach-rider'});
  return {google:stops.length<=3?google.href:null,waze:waze.href,tooManyStops:stops.length>3};
}
export function forecastPlan(sampleLists) {
  const locations=[],indices=new Map();
  const lookups=sampleLists.map(samples=>samples.map(s=>{
    const key=`${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
    if(!indices.has(key)){indices.set(key,locations.length);locations.push({lat:+s.lat.toFixed(4),lon:+s.lon.toFixed(4)});}
    return indices.get(key);
  }));
  return {locations,lookups};
}
