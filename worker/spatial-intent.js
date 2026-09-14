const KINDS=new Set(['reveal','orbit','hold','walk']);
const PACES=new Set(['slow','normal','fast']);
const safeObjectKinds=new Set(['sofa','chair','coffee-table','table','island','counter','bed','desk','shelf','wardrobe','bathtub','toilet','plant','tree','lamp','rug','console','nightstand','stool']);
const exact=(value,keys)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key)));

export function validateSpatialIntent(intent,model){
  if(!exact(intent,['roomIds','duration','shotPreferences','eyeHeight']))return false;
  const rooms=new Set(model.rooms.map(room=>room.id));
  if(!Array.isArray(intent.roomIds)||!intent.roomIds.length||intent.roomIds.length>12||!intent.roomIds.every(id=>typeof id==='string'&&rooms.has(id)))return false;
  if(!Number.isFinite(intent.duration)||intent.duration<10||intent.duration>180)return false;
  if(intent.eyeHeight!==undefined&&(!Number.isFinite(intent.eyeHeight)||intent.eyeHeight<1500||intent.eyeHeight>1800))return false;
  if(intent.shotPreferences===undefined)return true;
  if(!Array.isArray(intent.shotPreferences)||intent.shotPreferences.length>12)return false;
  if(new Set(intent.shotPreferences.map(shot=>shot?.roomId)).size!==intent.shotPreferences.length)return false;
  // Reserve travel time, matching the geometry generator's timing contract.
  if(intent.shotPreferences.reduce((sum,shot)=>sum+(Number.isFinite(shot?.duration)?shot.duration:0)*intent.roomIds.filter(id=>id===shot?.roomId).length,0)>=intent.duration-.5)return false;
  return intent.shotPreferences.every(shot=>{
    if(!exact(shot,['roomId','subjectId','kind','pace','duration'])||!rooms.has(shot.roomId)||!intent.roomIds.includes(shot.roomId)||!KINDS.has(shot.kind)||!PACES.has(shot.pace))return false;
    if(shot.duration!==undefined&&(!Number.isFinite(shot.duration)||shot.duration<.5||shot.duration>60))return false;
    if(shot.subjectId!==undefined&&!model.furniture.some(item=>item.id===shot.subjectId&&item.roomId===shot.roomId))return false;
    return true;
  });
}

export function providerIntentContext(model,intent){
  const rooms=new Map(model.rooms.map((room,i)=>[room.id,`room-${i+1}`]));
  const subjects=new Map(model.furniture.map((item,i)=>[item.id,`subject-${i+1}`]));
  const toProvider=source=>({
    roomIds:source.roomIds.map(id=>rooms.get(id)),duration:source.duration,
    ...(source.eyeHeight!==undefined?{eyeHeight:source.eyeHeight}:{}),
    ...(source.shotPreferences?{shotPreferences:source.shotPreferences.map(shot=>({...shot,roomId:rooms.get(shot.roomId),...(shot.subjectId?{subjectId:subjects.get(shot.subjectId)}:{})}))}:{}),
  });
  const reverseRooms=new Map([...rooms].map(([id,alias])=>[alias,id]));
  const reverseSubjects=new Map([...subjects].map(([id,alias])=>[alias,id]));
  return {
    data:{
      rooms:model.rooms.map(room=>({id:rooms.get(room.id),exterior:room.exterior,floor:model.floors.findIndex(floor=>floor.id===room.floorId)+1})),
      subjects:model.furniture.map(item=>({id:subjects.get(item.id),roomId:rooms.get(item.roomId),kind:safeObjectKinds.has(item.kind)?item.kind:'object'})),
      requested:toProvider(intent),
    },
    fromProvider:source=>{
      if(!exact(source,['roomIds','duration','shotPreferences','eyeHeight']))return null;
      return {...source,
        roomIds:Array.isArray(source.roomIds)?source.roomIds.map(id=>reverseRooms.get(id)||null):null,
        ...(Array.isArray(source.shotPreferences)?{shotPreferences:source.shotPreferences.map(shot=>{
          if(!exact(shot,['roomId','subjectId','kind','pace','duration']))return null;
          return {...shot,roomId:reverseRooms.get(shot.roomId)||null,...(shot.subjectId!==undefined?{subjectId:reverseSubjects.get(shot.subjectId)||null}:{})};
        })}:{}),
      };
    },
  };
}

export function tourIntentResponseSchema(context){
  const requested=context.requested,preferences=requested.shotPreferences||[];
  const roomIds=[...new Set(requested.roomIds)];
  const fixed=(type,value)=>({type,enum:[value]});
  const shotSchema=(roomId,requestedShot)=>{
    const subjects=context.subjects.filter(subject=>subject.roomId===roomId).map(subject=>subject.id);
    const properties={roomId:fixed('string',roomId),kind:requestedShot?fixed('string',requestedShot.kind):{type:'string',enum:[...KINDS]},pace:requestedShot?fixed('string',requestedShot.pace):{type:'string',enum:[...PACES]}};
    const required=['roomId','kind','pace'];
    if(requestedShot?.subjectId!==undefined){properties.subjectId=fixed('string',requestedShot.subjectId);required.push('subjectId');}
    else if(subjects.length)properties.subjectId={type:'string',enum:subjects};
    // Timing is allocated by the geometry engine. Only explicitly fixed shot
    // durations belong in provider output; invented totals can erase travel.
    if(requestedShot?.duration!==undefined){properties.duration=fixed('number',requestedShot.duration);required.push('duration');}
    return {type:'object',properties,required,additionalProperties:false};
  };
  const shotPreferences={type:'array',minItems:preferences.length,maxItems:roomIds.length};
  if(preferences.length)shotPreferences.prefixItems=preferences.map(shot=>shotSchema(shot.roomId,shot));
  // Keep items compatible with the fixed prefix too. The provider documents
  // prefixItems and items separately; this avoids contradictory item schemas.
  shotPreferences.items={anyOf:roomIds.map(roomId=>shotSchema(roomId,preferences.find(shot=>shot.roomId===roomId)))};
  const properties={
    roomIds:{type:'array',prefixItems:requested.roomIds.map(id=>fixed('string',id)),minItems:requested.roomIds.length,maxItems:requested.roomIds.length},
    duration:fixed('number',requested.duration),shotPreferences,
  },required=['roomIds','duration','shotPreferences'];
  if(requested.eyeHeight!==undefined){properties.eyeHeight=fixed('number',requested.eyeHeight);required.push('eyeHeight');}
  return {type:'object',properties,required,additionalProperties:false};
}

export const spatialIntentPrompt='Direct a coherent architectural camera tour using only the supplied anonymous room and subject references. Return JSON matching the response schema. Copy requested.roomIds exactly, in the same order, including repeated stops. Copy requested.duration exactly as the TOTAL tour duration. If requested.eyeHeight is present, return that exact value in millimetres; never omit or change it. Begin shotPreferences with every requested preference in its given order, preserving every explicit subjectId, kind, pace and duration. You may add one complementary preference for a selected room that has none, using only a subject belonging to that room. Never repeat a room in shotPreferences or add an unselected room. Do not invent fixed shot durations: include duration only when that requested preference already contains it, with the exact same value. The application allocates all remaining time among movement and shots, and fixed durations must leave time for travel. Do not return coordinates, names, code, notes or design changes. Data: ';

/** Fixed diagnostic categories only; never return provider text, names or values. */
export function spatialIntentMismatchReasons(result,requested,model){
  const reasons=[];
  if(!result||typeof result!=='object'||Array.isArray(result))return ['invalid_intent_shape'];
  if(JSON.stringify(result.roomIds)!==JSON.stringify(requested.roomIds))reasons.push('room_order_changed');
  if(result.duration!==requested.duration)reasons.push('total_duration_changed');
  if(requested.eyeHeight!==undefined&&result.eyeHeight!==requested.eyeHeight)reasons.push('eye_height_missing_or_changed');
  const preferences=Array.isArray(result.shotPreferences)?result.shotPreferences:[];
  for(const shot of requested.shotPreferences||[]){
    const candidate=preferences.find(item=>item?.roomId===shot.roomId);
    if(!candidate){reasons.push('requested_preference_missing');continue;}
    for(const [key,code] of [['subjectId','subject_missing_or_changed'],['kind','shot_kind_changed'],['pace','pace_changed'],['duration','fixed_duration_missing_or_changed']])if(shot[key]!==undefined&&candidate[key]!==shot[key])reasons.push(code);
  }
  if(Array.isArray(result.roomIds)&&preferences.reduce((sum,shot)=>sum+(Number.isFinite(shot?.duration)?shot.duration:0)*result.roomIds.filter(id=>id===shot?.roomId).length,0)>=result.duration-.5)reasons.push('travel_budget_exhausted');
  if(!validateSpatialIntent(result,model))reasons.push('invalid_intent_constraints');
  return [...new Set(reasons)];
}

export function preservesRequestedDirection(result,requested){
  return JSON.stringify(result.roomIds)===JSON.stringify(requested.roomIds)&&result.duration===requested.duration
    &&(requested.eyeHeight===undefined||result.eyeHeight===requested.eyeHeight)
    &&(requested.shotPreferences||[]).every(shot=>(result.shotPreferences||[]).some(candidate=>Object.entries(shot).every(([key,value])=>candidate[key]===value)));
}
