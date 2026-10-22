import FlowClient from "../flow-client";
import {requireChatGPTUser} from "../chatgpt-auth";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{path:string[]}>}){const {path}=await params;await requireChatGPTUser("/"+path.join("/"));return <FlowClient/>;}
