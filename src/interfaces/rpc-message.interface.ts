export interface IRPCMessageResult {
    "jsonrpc": "2.0",
    "result": { 
        "message": string;
        "data": unknown;
    },
    "id": number;
}
export interface IRPCMessageError {
    "jsonrpc": "2.0",
    "error": { 
        "message": string;
        "data": unknown;
        "code": number;
    },    
    "id": number;
}