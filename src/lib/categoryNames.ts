export function categoryName(value:string):string{
  return ({wafer:"WaferID",lot:"Lot",site:"Site",hbin:"HBIN",sbin:"SBIN",none:"Bin"}as Record<string,string>)[value]??value.replace(/^data:(test|text):/,"");
}
