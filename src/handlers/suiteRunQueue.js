import { processSuiteRunOrchestrationMessage } from '../services/suiteRunService.js';
import { recordSuiteRunOrchestrationError } from '../repositories/suiteRunRepository.js';

function scopedMessage(body){
  return body && typeof body.suiteRunId==='string' && typeof body.organizationId==='string' && typeof body.projectId==='string';
}

export async function handleSuiteRunQueue(batch,env){
  for(const message of batch?.messages||[]){
    try{
      await processSuiteRunOrchestrationMessage({env,message:message.body});
      if(typeof message.ack==='function') message.ack();
    }catch(error){
      const nonRetryable=error?.retryable===false || (Number(error?.status||0)>=400 && Number(error?.status||0)<500);
      try{
        console.log(JSON.stringify({type:'suite_run_orchestration_error',time:new Date().toISOString(),suiteRunId:message?.body?.suiteRunId||null,code:error?.code||null,retryable:!nonRetryable,status:error?.status||500}));
      }catch{}
      if(scopedMessage(message?.body)){
        try{
          await recordSuiteRunOrchestrationError(env,{
            organizationId:message.body.organizationId,
            projectId:message.body.projectId,
            suiteRunId:message.body.suiteRunId,
            errorCode:error?.code||'SUITE_ORCHESTRATION_FAILED',
            terminal:nonRetryable,
          });
        }catch{}
      }
      if(nonRetryable){
        if(typeof message.ack==='function') message.ack();
      }else if(typeof message.retry==='function') message.retry();
      else throw error;
    }
  }
}
