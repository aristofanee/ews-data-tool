use crate::model::*;
use std::collections::HashMap;

const AUTO_LEVELS:usize=64;
const MANUAL_LEVELS:usize=u16::MAX as usize-1;
fn is_timestamp(value:&str)->bool{
    let s=value.as_bytes();
    (s.len()>=10&&s.get(4)==Some(&b'-')&&s.get(7)==Some(&b'-')&&s[..4].iter().all(u8::is_ascii_digit))||
    (s.len()>=8&&s.get(2)==Some(&b':')&&s.get(5)==Some(&b':')&&s[..2].iter().all(u8::is_ascii_digit))||
    (s.len()>=10&&s.get(2)==Some(&b'/')&&s.get(5)==Some(&b'/')&&s[..2].iter().all(u8::is_ascii_digit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{dataset::Imported,query::*};

    fn fixture()->Dataset{
        let mut imp=Imported::new();let lot=imp.lot_index("L");
        for w in 0..2{let wafer=imp.wafer_index(lot,&format!("W{w}"));for x in 0..100{
            let row=imp.new_row(lot,wafer);imp.x[row]=x;imp.y[row]=0;imp.hbin[row]=if x%2==0{1}else{2};imp.sbin[row]=imp.hbin[row];imp.site[row]=Some((x%4)as u8);
            imp.write_text("Mode",row,if row==5{""}else if row==7{"Unassigned"}else if x%2==0{"A"}else{"B"});
            imp.write_text("Part ID",row,&format!("die-{row}"));
            imp.write_text("Notes",row,&format!("{}{}","x".repeat(100),x%2));
            imp.write_text("Timestamp",row,if x%2==0{"2026-11-01T12:00:00"}else{"2026-11-02T12:00:00"});
        }}
        let fields=[("Code",""),("Setpoint","V"),("Fraction",""),("Counter",""),("Wafer code",""),("Rare",""),("Constant","")];
        for (i,(name,unit))in fields.into_iter().enumerate(){let mut t=TestInfo::new(name);t.number=Some(1000+i as u32);t.units=unit.into();imp.tests.push(t);imp.cols.push((0..200).map(|r|match i{0=>(r%2)as f32,1=>if r%2==0{0.8}else{1.2},2=>if r%2==0{1.25}else{1.75},3=>r as f32,4=>(r/100+1)as f32,5=>if r==0{9.0}else{0.0},_=>7.0}).collect());}
        let mut ds=Dataset::new();ds.append_import(imp.finish());ds.resolve_retests();ds.detect_numeric_labels();ds.detect_data_categories();ds
    }

    #[test]
    fn detects_row_categories_without_changing_measurements_or_wafer_labels(){
        let mut ds=fixture();
        assert!(ds.data_category("data:test:1000 - Code").is_some());
        assert!(ds.data_category("data:text:Mode").is_some());
        assert!(ds.data_category("data:test:1005 - Rare").is_some(),"one rare level is retained");
        for id in ["data:test:1001 - Setpoint [V]","data:test:1002 - Fraction","data:test:1003 - Counter","data:test:1004 - Wafer code","data:test:1006 - Constant","data:text:Part ID","data:text:Notes","data:text:Timestamp"]{assert!(ds.data_category(id).is_none(),"{id} should not be automatic");}
        assert!(ds.custom_column("Code").is_none());assert!(ds.custom_column("Wafer code").is_some());
        assert_eq!(ds.tests.len(),7);assert_eq!(ds.cols[0][0],0.0);assert_eq!(ds.cols[0][1],1.0);
        let mode=ds.data_category("data:text:Mode").unwrap();assert_eq!(mode.counts.iter().sum::<usize>(),200);assert_ne!(mode.label(0),"Unassigned");assert!(mode.values.contains(&"Unassigned".into()));
        ds.set_data_category("data:test:1001 - Setpoint [V]",true).unwrap();let c=ds.data_category("data:test:1001 - Setpoint [V]").unwrap();assert!(!c.automatic);assert_eq!(c.values,vec!["","0.8","1.2"]);
        ds.set_data_category("data:test:1002 - Fraction",true).unwrap();assert_eq!(ds.data_category("data:test:1002 - Fraction").unwrap().values,vec!["","1.25","1.75"]);
        ds.set_data_category("data:test:1001 - Setpoint [V]",false).unwrap();assert!(ds.data_category("data:test:1001 - Setpoint [V]").is_none());assert_eq!(ds.cols[1][0],0.8);
    }

    #[test]
    fn category_groups_and_filters_are_correct_across_all_queries(){
        let ds=fixture();let category="data:test:1000 - Code";
        let b=box_plot(&ds,&BoxRequest{test:1,x_axis:category.into(),group_by:Some(category.into()),filter:Default::default(),max_points:Some(1)});
        assert_eq!(b.groups.len(),2);assert_eq!(b.groups.iter().map(|g|g.summary.n).sum::<usize>(),200);
        let h=histogram(&ds,&HistRequest{test:1,bins:Some(4),group_by:Some(category.into()),filter:Default::default()});assert_eq!(h.groups.len(),2);assert_eq!(h.groups.iter().flat_map(|g|&g.counts).sum::<u32>(),200);
        let t=trend(&ds,&TrendRequest{test:1,by:category.into(),group_by:Some(category.into()),filter:Default::default()});assert_eq!(t.points.iter().map(|p|p.n).sum::<usize>(),200);
        let s=scatter(&ds,&ScatterRequest{x_test:0,y_test:1,z_mode:ScatterZMode::None,z_col:None,z_test:None,group_by:Some(category.into()),filter:Default::default(),max_points:Some(5)});assert_eq!(s.series.len(),2);assert_eq!(s.group_totals.values().sum::<usize>(),200);
        let p=pareto(&ds,&ParetoRequest{category:BinCategory::Hard,group_by:Some(category.into()),top:Some(10),filter:Default::default()});assert_eq!(p.groups.len(),2);assert_eq!(p.groups.iter().find(|g|g.label=="0").unwrap().yield_pct,100.0);assert_eq!(p.groups.iter().find(|g|g.label=="1").unwrap().yield_pct,0.0);
        let mut f=Filter::default();f.categories.insert(category.into(),vec!["1".into()]);
        assert_eq!(ds.base_mask(&f).iter().filter(|&&v|v).count(),100);
        let m=wafer_map(&ds,&MapRequest{test:Some(1),wafer:None,mode:MapMode::Value,filter:f.clone(),lsl:None,usl:None});assert_eq!(m.test_total,100);assert_eq!(m.dice.len(),50);
        let p=pareto(&ds,&ParetoRequest{category:BinCategory::Hard,group_by:None,top:Some(10),filter:f.clone()});assert_eq!(p.total,100);assert_eq!(p.yield_pct,0.0);
        let c=limit_counts(&ds,&LimitCountsRequest{test:1,paired_test:None,group_by:None,filter:f.clone(),lsl:Some(1.0),usl:Some(1.3)});assert_eq!(c.total,100);assert_eq!(c.in_limits,Some(100));
        f.categories.insert(category.into(),vec!["not-present".into()]);assert!(!ds.base_mask(&f).iter().any(|&v|v));
        f.categories.insert("unknown-field".into(),vec!["A".into()]);assert!(!ds.base_mask(&f).iter().any(|&v|v));
    }
}
fn repeated_and_varied(ds:&Dataset,codes:&[u16],counts:&[usize])->bool{
    let mut first=vec![None;ds.wafers.len()];let mut varied=false;
    for (row,&code)in codes.iter().enumerate(){if code==0{continue;}let w=ds.wafer_of_row[row]as usize;if first[w].is_some_and(|v|v!=code){varied=true;break;}first[w]=Some(code);}
    let total:usize=counts[1..].iter().sum();let repeated:usize=counts[1..].iter().filter(|&&n|n>1).sum();
    varied&&total>0&&repeated*10>=total*9
}

impl Dataset {
    #[cfg(test)]
    fn category_sources(&self)->Vec<CategorySourceInfo>{
        self.tests.iter().map(|t|CategorySourceInfo{id:format!("data:test:{}",t.display_with_units()),name:t.display_with_units(),kind:"test".into()})
            .chain(self.text_cols.iter().map(|c|CategorySourceInfo{id:format!("data:text:{}",c.name),name:c.name.clone(),kind:"text".into()})).collect()
    }
    pub fn data_category(&self,id:&str)->Option<&DataCategory>{self.data_categories.iter().find(|c|c.id==id)}

    fn build_data_category(&self,source:CategorySourceInfo,index:usize,manual:bool,sample:&[usize])->Result<DataCategory,String>{
        let id=source.id.clone();
        let limit=if manual{MANUAL_LEVELS}else{AUTO_LEVELS};
        let mut values=vec![String::new()];let mut codes=Vec::with_capacity(self.rows);
        if source.kind=="test"{
            let test=&self.tests[index];
            if !manual&&self.numeric_label_sources.values().any(|&source|source==index){return Err("This field is already a wafer-level label".into());}
            if !manual&&!test.units.trim().is_empty(){return Err("Measurements with units need an explicit category override".into());}
            if !manual{
                let mut distinct=std::collections::HashSet::new();
                for &row in sample{let v=self.cols[index][row];if v.is_nan(){continue;}if !v.is_finite()||v.fract()!=0.0{return Err("Fractional measurements need an explicit category override".into());}distinct.insert(if v==0.0{0}else{v.to_bits()});if distinct.len()>limit{return Err("Too many category values".into());}}
                if distinct.len()<2{return Err("The sample has only one value".into());}
            }
            let mut lookup=HashMap::new();
            for &v in &self.cols[index]{
                if v.is_nan()||manual&&!v.is_finite(){codes.push(0);continue;}
                if !v.is_finite()||!manual&&v.fract()!=0.0{return Err("Fractional values are measurements".into());}
                let key=if v==0.0{0}else{v.to_bits()};
                let code=if let Some(&code)=lookup.get(&key){code}else{if values.len()>limit{return Err(format!("A category supports at most {limit} distinct values"));}let code=values.len()as u16;lookup.insert(key,code);values.push(if v==0.0{"0".into()}else{v.to_string()});code};codes.push(code);
            }
        }else{
            let column=&self.text_cols[index];
            if !manual&&self.text_label_sources.contains_key(&column.name){return Err("This field is already a wafer-level label".into());}
            let mut lookup=HashMap::new();
            for &original in &column.codes{
                if original==0{codes.push(0);continue;}
                let value=&column.values[original as usize];
                if !manual&&(value.chars().count()>80||is_timestamp(value)){return Err("Free-form text and timestamps are not automatic categories".into());}
                let code=if let Some(&code)=lookup.get(&original){code}else{if values.len()>limit{return Err(format!("A category supports at most {limit} distinct values"));}let code=values.len()as u16;lookup.insert(original,code);values.push(value.clone());code};codes.push(code);
            }
        }
        if codes.len()!=self.rows||values.len()<2{return Err("No values are available for this category".into());}
        let mut order:Vec<_>=(1..values.len()).collect();
        order.sort_by(|&a,&b|if source.kind=="test"{values[a].parse::<f32>().unwrap().total_cmp(&values[b].parse::<f32>().unwrap())}else{crate::stats::natural_cmp(&values[a],&values[b])});
        let mut remap=vec![0;values.len()];let mut sorted=vec![String::new()];
        for old in order{remap[old]=sorted.len()as u16;sorted.push(values[old].clone());}values=sorted;
        let mut counts=vec![0;values.len()];for code in &mut codes{*code=remap[*code as usize];counts[*code as usize]+=1;}
        if !manual&&(values.len()<3||!repeated_and_varied(self,&codes,&counts)){return Err("Automatic categories require repeated values that vary within a wafer".into());}
        Ok(DataCategory{id,name:source.name,values,codes,counts,automatic:!manual})
    }

    pub fn detect_data_categories(&mut self){
        // Rebuild wafer-level text assignments from the retained die records.
        for column in &self.text_cols{
            if self.custom_cols.iter().any(|c|c.name==column.name)&&!self.text_label_sources.contains_key(&column.name){continue;}
            let mut per_wafer=vec![None;self.wafers.len()];let mut conflict=false;
            for (r,&code)in column.codes.iter().enumerate(){if code==0{continue;}let w=self.wafer_of_row[r]as usize;if per_wafer[w].is_some_and(|v|v!=code){conflict=true;break;}per_wafer[w]=Some(code);}
            let mut labels:Vec<_>=per_wafer.iter().flatten().map(|&code|column.values[code as usize].clone()).collect();labels.sort();labels.dedup();
            if conflict||labels.is_empty()||labels.len()>512{
                if self.text_label_sources.remove(&column.name).is_some(){self.custom_cols.retain(|c|c.name!=column.name);}continue;
            }
            let mut categories=vec![String::new()];categories.extend(labels);
            let values=per_wafer.into_iter().map(|value|value.map(|code|categories.iter().position(|s|s==&column.values[code as usize]).unwrap()as u16).unwrap_or(0)).collect();
            let custom=CustomColumn{name:column.name.clone(),categories,wafer_values:values};
            if let Some(index)=self.custom_cols.iter().position(|c|c.name==column.name){self.custom_cols[index]=custom;}else{self.custom_cols.push(custom);}
            self.text_label_sources.insert(column.name.clone(),column.name.clone());
        }
        self.data_categories.clear();
        let sample=crate::numeric_labels::sample_rows(self);
        for (i,t)in self.tests.iter().enumerate(){if !t.units.trim().is_empty(){continue;}let source=CategorySourceInfo{id:format!("data:test:{}",t.display_with_units()),name:t.display_with_units(),kind:"test".into()};if let Ok(category)=self.build_data_category(source,i,false,&sample){self.data_categories.push(category);}}
        for (i,c)in self.text_cols.iter().enumerate(){let source=CategorySourceInfo{id:format!("data:text:{}",c.name),name:c.name.clone(),kind:"text".into()};if let Ok(category)=self.build_data_category(source,i,false,&[]){self.data_categories.push(category);}}
        for c in &mut self.text_cols{c.lookup.clear();c.lookup.shrink_to_fit();}
    }
    #[cfg(test)]
    pub fn set_data_category(&mut self,id:&str,enabled:bool)->Result<(),String>{
        if enabled{let (index,source)=self.category_sources().into_iter().enumerate().find(|(_,s)|s.id==id).ok_or("Category source is no longer available")?;let index=if source.kind=="text"{index-self.tests.len()}else{index};let category=self.build_data_category(source,index,true,&[])?;self.data_categories.retain(|c|c.id!=id);self.data_categories.push(category);}else{self.data_categories.retain(|c|c.id!=id);}Ok(())
    }
}
