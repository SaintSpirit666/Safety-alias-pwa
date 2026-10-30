const EVENT_CONFIG=Object.freeze({
  probability:0.25,
  events:Object.freeze([
    Object.freeze({id:'double_shift',title:'Двойная смена',icon:'⏱️',description:'Время раунда увеличено на 50%. Очки начисляются по обычным правилам.',durationMultiplier:1.5}),
    Object.freeze({id:'emergency_blitz',title:'Аварийный блиц',icon:'🚨',description:'Времени вдвое меньше, но каждая угаданная карточка приносит 2 очка.',durationMultiplier:0.5}),
    Object.freeze({id:'safety_bonus',title:'Премия за безопасность',icon:'🏅',description:'Угадайте не менее 5 карточек без пропусков и получите +3 очка в конце раунда.'}),
    Object.freeze({id:'knowledge_check',title:'Проверка знаний',icon:'🧠',description:'Каждые 3 угаданные карточки подряд приносят дополнительные +2 очка.'}),
    Object.freeze({id:'no_mistake',title:'Без права на ошибку',icon:'🎯',description:'До первого пропуска каждая угаданная карточка приносит 2 очка, затем — 1.'}),
    Object.freeze({id:'last_push',title:'Последний рывок',icon:'⚡',description:'В последние 10 секунд каждая угаданная карточка приносит 2 очка.'}),
  ]),
});

function getEventDefinition(id){return EVENT_CONFIG.events.find(event=>event.id===id)||null}
function createRoundEvent(id){const definition=getEventDefinition(id);if(!definition)return null;return{id,announced:false,state:{correctCount:0,skipCount:0,streak:0,mistake:false,bonusPoints:0,finalized:false}}}
function selectRoundEvent(random=Math.random){if(random()>=EVENT_CONFIG.probability)return null;const index=Math.min(EVENT_CONFIG.events.length-1,Math.floor(random()*EVENT_CONFIG.events.length));return createRoundEvent(EVENT_CONFIG.events[index].id)}
function getEventRoundDuration(baseSeconds,event){const definition=event&&getEventDefinition(event.id);return Math.max(10,Math.round(baseSeconds*(definition?.durationMultiplier||1)))}
function applyEventAnswer(event,answer){const basePoints=Number(answer.basePoints)||0;if(!event)return{points:basePoints,event:null,bonus:0};const state={...event.state};let points=basePoints,bonus=0;if(answer.ok){state.correctCount+=1;state.streak+=1;if(event.id==='emergency_blitz')points=2;if(event.id==='knowledge_check'&&state.streak%3===0){bonus=2;points+=bonus}if(event.id==='no_mistake'&&!state.mistake)points=2;if(event.id==='last_push'&&answer.remaining<=10)points=2}else{state.skipCount+=1;state.streak=0;if(event.id==='no_mistake')state.mistake=true}state.bonusPoints+=bonus;return{points,bonus,event:{...event,state}}}
function finalizeRoundEvent(event){if(!event||event.state.finalized)return{bonus:0,event};const state={...event.state,finalized:true};let bonus=0;if(event.id==='safety_bonus'&&state.correctCount>=5&&state.skipCount===0)bonus=3;state.bonusPoints+=bonus;return{bonus,event:{...event,state}}}
function getEventProgress(event){if(!event)return'';const state=event.state;switch(event.id){case'safety_bonus':return`${Math.min(state.correctCount,5)}/5, пропусков: ${state.skipCount}`;case'knowledge_check':return`Серия: ${state.streak}/3, бонус: +${state.bonusPoints}`;case'no_mistake':return state.mistake?'Бонус ×2 завершён':'Бонус ×2 действует';case'last_push':return'Бонус ×2 включится на последних 10 секундах';case'emergency_blitz':return'Каждая угаданная: +2';case'double_shift':return'Увеличенное время, обычные очки';default:return''}}
