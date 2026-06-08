
export const logger = {
  info(message:string, meta?:unknown){
    console.info(JSON.stringify({level:'info', message, meta}));
  },
  error(message:string, meta?:unknown){
    console.error(JSON.stringify({level:'error', message, meta}));
  }
};
