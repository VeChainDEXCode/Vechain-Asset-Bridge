import { Framework } from "@vechain/connex-framework";
import { Contract } from "myvetools";
import path from "path";
import { compileContract } from "myvetools/dist/utils";
import { abi, keccak256, Transaction } from "thor-devkit";
import { SimpleWallet } from "@vechain/connex-driver";
import { ActionData } from "./utils/components/actionResult";
import { Proposal } from "./utils/types/proposal";
import { ZeroRoot } from "./utils/types/bridgeSnapshoot";
import { sleep } from "./utils/sleep";

export class VeChainBridgeVerifiter {
    constructor(env:any){
        this.env = env;
        this.connex = this.env.connex;
        this.config = this.env.config;
        this.wallet = this.env.wallet;
        this.initV2eVerifiter();
    }

    private readonly scanBlockStep = 100;

    public async isVerifier(address:string):Promise<ActionData<boolean>>{
        let result = new ActionData<boolean>();
        try {
            const call = await this.v2eVerifiter.call("verifiers",address);
            result.data = Boolean(BigInt(call.decoded[0]));
        } catch (error) {
            result.error = error;
        }
        return result;
    }

    public async getLockBridgeProposal(hash:string):Promise<ActionData<Proposal>>{
        let result = new ActionData<Proposal>();

        try {
            const call = await this.v2eVerifiter.call("getLockBridgeProposals",hash);
            let p:Proposal = {
                hash:hash,
                quorum:Number(call.decoded[0][0]),
                executed:Boolean(call.decoded[0][1]),
                value:String(call.decoded[0][2]),
                signatures:(call.decoded[0][3] as Array<string>)
            }
            result.data = p;
        } catch (error) {
            result.error = error;
        }

        return result;
    }

    public async getMerkleRootProposals(hash:string):Promise<ActionData<Proposal>>{
        let result = new ActionData<Proposal>();

        try {
            const call = await this.v2eVerifiter.call("getMerkleRootProposal",hash);
            let p:Proposal = {
                hash:hash,
                quorum:Number(call.decoded[0][0]),
                executed:Boolean(call.decoded[0][1]),
                value:String(call.decoded[0][2]),
                signatures:(call.decoded[0][3] as Array<string>)
            }
            result.data = p;
        } catch (error) {
            result.error = error;
        }

        return result;
    }

    public async lockBridge(lastRoot:string):Promise<ActionData<string>>{
        let result = new ActionData<string>();

        try {
            const msgHash = this.signEncodePacked("lockBridge",lastRoot);
            const sign = await this.wallet.list[0].sign(msgHash);

            console.info(`signer ${this.wallet.list[0].address} sign: ${sign.toString('hex')}`);

            const clause = this.v2eVerifiter.send("lockBridge",0,lastRoot,sign);
            const txrep = await this.connex.vendor.sign("tx",[clause])
                .signer(this.wallet.list[0].address)
                .request();
            result.data = txrep.txid;
        } catch (error) {
            result.error = error;
        }
        return result;
    }

    public async updateBridgeMerkleRoot(lastRoot:string,newRoot:string):Promise<ActionData<string>>{
        let result = new ActionData<string>();

        try {
            const msgHash = this.signEncodePacked("updateBridgeMerkleRoot",newRoot);
            const sign = await this.wallet.list[0].sign(msgHash);
            const clause = this.v2eVerifiter.send("updateBridgeMerkleRoot",0,lastRoot,newRoot,sign);
            const txrep = await this.connex.vendor.sign("tx",[clause])
                .signer(this.wallet.list[0].address)
                .request();
            result.data = txrep.txid;
        } catch (error) {
            result.error = error;
        }
        return result;
    }

    public async checkTxStatus(txid:string,blockRef:number):Promise<ActionData<"reverted"|"confirmed"|"expired"|"pendding">>{
        let result = new ActionData<"reverted"|"confirmed"|"expired"|"pendding">();
        const bestBlock = (await this.connex.thor.block().get())!.number;

        try {
            const receipt = await this.connex.thor.transaction(txid).getReceipt();
            if(receipt != null && bestBlock - blockRef > this.config.vechain.confirmHeight){
                if(receipt.reverted){
                    result.data = "reverted";
                } else {
                    result.data = "confirmed";
                }
            } else if(bestBlock - blockRef > this.config.vechain.expiration) {
                result.data = "expired";
            } else {
                console.debug(`pending ${bestBlock - blockRef}/${this.config.vechain.confirmHeight}`);
                result.data = "pendding";
            }
        } catch (error) {
            result.error = error;
        }
        return result;
    }

    public async confirmTx(txid:string):Promise<ActionData<"reverted"|"confirmed"|"expired">>{
        let result = new ActionData<"reverted"|"confirmed"|"expired">();
        const blockRefNum = (await this.connex.thor.block().get())!.number;
        while(true){
            const bestBlock = (await this.connex.thor.block().get())!.number;
            try {
                const receipt = await this.connex.thor.transaction(txid).getReceipt();
                if(receipt != null){
                    if(receipt.reverted){
                        result.data = "reverted";
                        console.info(`transaction ${txid} reverted`);
                        break;
                    }
                    if(bestBlock - receipt.meta.blockNumber >= this.config.vechain.confirmHeight){
                        result.data = "confirmed";
                        break;
                    } else {
                        continue;
                    }
                } else {
                    if(bestBlock - blockRefNum > this.config.vechain.expiration){
                        result.data = "expired";
                        break;
                    }
                }
            } catch (error) {
                result.error = error;
                break;
            }
            await sleep(10 * 1000);
        }
        
        return result;
    }

    public async getVerifiers(begin:number,end:number):Promise<ActionData<string[]>> {
        let result = new ActionData<string[]>();
        result.data = new Array<string>();



        try {
            for(let block = begin; block <= end;){
                let from = block;
                let to = block + this.scanBlockStep > end ? end:block + this.scanBlockStep;
    
                console.debug(`scan verifiers update: ${from} - ${to}`);

                // let events = await this.connex.thor.filter("event",[
                //     {address:this.config.vechain.contracts.v2eBridge,topic0:this.VerifierChangedEvent.signature}
                // ]).order("asc").range({unit:"block",from:from,to:to}).apply(0,200);

                // for(const event of events){
                    
                // }


                block = to + 1;
            }
        } catch (error) {
            result.error = error;
        }
        return result;
    }

    private initV2eVerifiter(){
        const filePath = path.join(this.env.contractdir,"/vechainthor/Contract_V2EBridgeVerifier.sol");
        const abi = JSON.parse(compileContract(filePath, 'V2EBridgeVerifier', 'abi',[this.env.contractdir]));
        this.v2eVerifiter = new Contract({abi:abi,connex:this.connex,address:this.config.vechain.contracts.v2eBridgeVerifier});
    }

    private signEncodePacked(opertion:string,hash:string):Buffer{
        let hashBuffer = hash != ZeroRoot() ? Buffer.from(hash.substring(2),'hex') : Buffer.alloc(32);
        let encode = Buffer.concat([
            Buffer.from(opertion),
            hashBuffer
        ]);
        return keccak256(encode);
    }

    private env:any;
    private config:any;
    private v2eVerifiter!:Contract;
    private connex!:Framework;
    private wallet!:SimpleWallet;
}
