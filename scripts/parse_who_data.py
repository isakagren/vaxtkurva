import os
import json
import pandas as pd

def clean_col_name(col):
    if not isinstance(col, str):
        return col
    return col.strip()

def process_file(filepath):
    # Read excel file
    df = pd.read_excel(filepath)
    # Clean column names (remove leading/trailing spaces)
    df.columns = [clean_col_name(c) for c in df.columns]
    
    # Determine the x column (Age/Length/Height)
    x_col = None
    for col in df.columns:
        col_lower = col.lower()
        if 'week' in col_lower:
            x_col = col
            break
        elif 'month' in col_lower:
            x_col = col
            break
        elif 'length' in col_lower:
            x_col = col
            break
        elif 'height' in col_lower:
            x_col = col
            break
            
    if not x_col:
        raise ValueError(f"Could not find x-axis column in {filepath}. Columns are: {list(df.columns)}")
        
    entries = []
    for idx, row in df.iterrows():
        # Clean up values to float
        x_val = float(row[x_col])
        l_val = float(row['L'])
        m_val = float(row['M'])
        s_val = float(row['S'])
        
        # Check standard deviation z-score columns
        sd3neg = float(row['SD3neg']) if 'SD3neg' in row else None
        sd2neg = float(row['SD2neg']) if 'SD2neg' in row else None
        sd1neg = float(row['SD1neg']) if 'SD1neg' in row else None
        sd0 = float(row['SD0']) if 'SD0' in row else m_val
        sd1 = float(row['SD1']) if 'SD1' in row else None
        sd2 = float(row['SD2']) if 'SD2' in row else None
        sd3 = float(row['SD3']) if 'SD3' in row else None
        
        # If any SD columns are missing, we can calculate them using the LMS formulas
        # Z-scores: -3, -2, -1, 0, 1, 2, 3
        def lms_val(z):
            if l_val != 0:
                return m_val * ((1.0 + l_val * s_val * z) ** (1.0 / l_val))
            else:
                import math
                return m_val * math.exp(s_val * z)
                
        sd3neg = sd3neg if sd3neg is not None else lms_val(-3)
        sd2neg = sd2neg if sd2neg is not None else lms_val(-2)
        sd1neg = sd1neg if sd1neg is not None else lms_val(-1)
        sd0 = sd0 if sd0 is not None else lms_val(0)
        sd1 = sd1 if sd1 is not None else lms_val(1)
        sd2 = sd2 if sd2 is not None else lms_val(2)
        sd3 = sd3 if sd3 is not None else lms_val(3)
        
        entries.append({
            'x': x_val,
            'l': l_val,
            'm': m_val,
            's': s_val,
            'sd3neg': sd3neg,
            'sd2neg': sd2neg,
            'sd1neg': sd1neg,
            'sd0': sd0,
            'sd1': sd1,
            'sd2': sd2,
            'sd3': sd3
        })
    return entries, x_col.lower()

def main():
    raw_dir = 'who-data-raw'
    out_dir = 'src/lib/data/who'
    os.makedirs(out_dir, exist_ok=True)
    
    # We will group by curve type and gender
    # Types: wfa (weight-for-age), lhfa (length-for-age), hcfa (head-circumference-for-age), wfl/wfh (weight-for-length/height)
    # We will create unified JSON objects for:
    # 1. wfa_boys.json, wfa_girls.json
    # 2. lhfa_boys.json, lhfa_girls.json
    # 3. hcfa_boys.json, hcfa_girls.json
    # 4. wfl_boys.json, wfl_girls.json (we can combine wfl and wfh into a single file or keep separate)
    
    groups = {
        'wfa_boys': {
            'weeks': 'wfa_boys_0-to-13-weeks_zscores.xlsx',
            'months': 'wfa_boys_0-to-5-years_zscores.xlsx'
        },
        'wfa_girls': {
            'weeks': 'wfa_girls_0-to-13-weeks_zscores.xlsx',
            'months': 'wfa_girls_0-to-5-years_zscores.xlsx'
        },
        'hcfa_boys': {
            'weeks': 'hcfa-boys-0-13-zscores.xlsx',
            'months': 'hcfa-boys-0-5-zscores.xlsx'
        },
        'hcfa_girls': {
            'weeks': 'hcfa-girls-0-13-zscores.xlsx',
            'months': 'hcfa-girls-0-5-zscores.xlsx'
        },
        'lhfa_boys': {
            'weeks': 'lhfa_boys_0-to-13-weeks_zscores.xlsx',
            'months_0to2': 'lhfa_boys_0-to-2-years_zscores.xlsx',
            'months_2to5': 'lhfa_boys_2-to-5-years_zscores.xlsx'
        },
        'lhfa_girls': {
            'weeks': 'lhfa_girls_0-to-13-weeks_zscores.xlsx',
            'months_0to2': 'lhfa_girls_0-to-2-years_zscores.xlsx',
            'months_2to5': 'lhfa_girls_2-to-5-years_zscores.xlsx'
        },
        # Weight-for-length/height
        'wfl_boys': {
            'length_0to2': 'wfl_boys_0-to-2-years_zscores.xlsx',
            'height_2to5': 'wfh_boys_2-to-5-years_zscores.xlsx'
        },
        'wfl_girls': {
            'length_0to2': 'wfl_girls_0-to-2-years_zscores.xlsx',
            'height_2to5': 'wfh_girls_2-to-5-years_zscores.xlsx'
        }
    }
    
    for key, files in groups.items():
        data = {}
        for subkey, filename in files.items():
            path = os.path.join(raw_dir, filename)
            if os.path.exists(path):
                print(f"Processing {path}...")
                entries, x_type = process_file(path)
                data[subkey] = entries
            else:
                print(f"WARNING: File {path} does not exist!")
        
        # Save to JSON
        out_path = os.path.join(out_dir, f"{key}.json")
        with open(out_path, 'w', encoding='utf-8') as out_f:
            json.dump(data, out_f, indent=2)
        print(f"Saved {out_path} successfully (keys: {list(data.keys())})")

if __name__ == '__main__':
    main()
