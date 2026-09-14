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

export const tourIntentResponseSchema={type:'object',properties:{
  roomIds:{type:'array',items:{type:'string'}},duration:{type:'number'},eyeHeight:{type:'number'},
  shotPreferences:{type:'array',items:{type:'object',properties:{roomId:{type:'string'},subjectId:{type:'string'},kind:{type:'string',enum:[...KINDS]},pace:{type:'string',enum:[...PACES]},duration:{type:'number'}},required:['roomId','kind','pace'],additionalProperties:false}},
},required:['roomIds','duration'],additionalProperties:false};

export function preservesRequestedDirection(result,requested){
  return JSON.stringify(result.roomIds)===JSON.stringify(requested.roomIds)&&result.duration===requested.duration
    &&(requested.eyeHeight===undefined||result.eyeHeight===requested.eyeHeight)
    &&(requested.shotPreferences||[]).every(shot=>(result.shotPreferences||[]).some(candidate=>Object.entries(shot).every(([key,value])=>candidate[key]===value)));
}
