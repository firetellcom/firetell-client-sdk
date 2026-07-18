export interface IRPCMessageResult {
    "jsonrpc": "2.0",
    "result": { 
        "message": string;
        "data": any;
    },
    "id": number;
}
export interface IRPCMessageError {
    "jsonrpc": "2.0",
    "error": { 
        "message": string;
        "data": any;
        "code": number;
    },    
    "id": number;
}