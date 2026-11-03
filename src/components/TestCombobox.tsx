import { useMemo } from "react";
import type { TestInfo } from "../types";
import { testLabelWithUnits } from "../lib/format";
import { SearchCombobox } from "./SearchCombobox";

export function TestCombobox({tests,value,onChange,label="Y test"}:{
  tests:TestInfo[];value:number|null;onChange:(value:number)=>void;label?:string;
}) {
  const options=useMemo(()=>tests.map((t,i)=>({value:String(i),label:testLabelWithUnits(t)})),[tests]);
  return <SearchCombobox options={options} value={value===null?null:String(value)} onChange={v=>onChange(Number(v))} label={label}/>;
}
