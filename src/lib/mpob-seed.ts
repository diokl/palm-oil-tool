// MPOB Initial Seed Data (2025 & 2026)
// Source: MPOB Monthly Reports

interface MpobRecord {
  category: string;
  item_name: string;
  year: number;
  month: number;
  value: number | null;
  value_rm?: number | null;
  parent_group?: string | null;
  sort_order: number;
}

// ============ STOCK DATA ============
const STOCK_PRODUCTS = [
  { name: 'C.P.STEARIN', sort: 1 },
  { name: 'C.P.OLEIN', sort: 2 },
  { name: 'RBD PALM OIL', sort: 3 },
  { name: 'RBD PALM OLEIN', sort: 4 },
  { name: 'RBD PALM STEARIN', sort: 5 },
  { name: 'PFAD', sort: 6 },
  { name: 'COOKING OIL', sort: 7 },
];

// [Jan2025, Feb2025, Mar2025, Apr2025, May2025, Jun2025, Jul2025, Aug2025, Sep2025, Oct2025, Nov2025, Dec2025]
const STOCK_2025: Record<string, (number | null)[]> = {
  'C.P.STEARIN':      [2500, 5340, 2440, 6156, 2709, 3582, 2876, 2510, 3782, 4225, 2462, 2245],
  'C.P.OLEIN':        [30964, 26724, 28520, 33274, 31146, 48510, 42839, 53789, 64957, 40364, 24253, 48727],
  'RBD PALM OIL':     [84304, 76285, 90531, 87277, 90043, 108108, 95367, 123719, 102140, 124701, 138236, 127987],
  'RBD PALM OLEIN':   [199337, 162620, 212275, 203039, 210831, 254452, 275492, 285595, 308999, 277769, 284080, 301125],
  'RBD PALM STEARIN': [92317, 113341, 123588, 140881, 145588, 139324, 145206, 133236, 132106, 154918, 171376, 175625],
  'PFAD':             [44200, 44618, 51790, 48062, 51081, 54763, 51508, 59572, 64797, 52650, 62211, 65323],
  'COOKING OIL':      [12949, 13425, 12972, 9612, 9194, 14355, 15253, 15367, 13804, 10586, 12885, 12543],
};

// [Jan2026, Feb2026, Mar2026, ...]
const STOCK_2026: Record<string, (number | null)[]> = {
  'C.P.STEARIN':      [3375, 5541, 4383, null, null, null, null, null, null, null, null, null],
  'C.P.OLEIN':        [25122, 38896, 36231, null, null, null, null, null, null, null, null, null],
  'RBD PALM OIL':     [110706, 153472, 105394, null, null, null, null, null, null, null, null, null],
  'RBD PALM OLEIN':   [261632, 230959, 255796, null, null, null, null, null, null, null, null, null],
  'RBD PALM STEARIN': [175195, 183816, 149671, null, null, null, null, null, null, null, null, null],
  'PFAD':             [80399, 76932, 78096, null, null, null, null, null, null, null, null, null],
  'COOKING OIL':      [13849, 9933, 10833, null, null, null, null, null, null, null, null, null],
};

// ============ PRODUCTION DATA ============
const PROD_PRODUCTS = STOCK_PRODUCTS; // Same products

const PROD_2025: Record<string, (number | null)[]> = {
  'C.P.STEARIN':      [1777, 2421, 1791, 2185, 3608, 5573, 4566, 6975, 2782, 3318, 1871, 2177],
  'C.P.OLEIN':        [53962, 49346, 39314, 28099, 50478, 41895, 51016, 52741, 63154, 107108, 54137, 68908],
  'RBD PALM OIL':     [1051476, 878668, 1075554, 1108795, 1300214, 1236768, 1222158, 1232368, 1148373, 1297288, 1253546, 1213355],
  'RBD PALM OLEIN':   [735130, 646675, 791788, 784589, 898145, 875230, 904739, 854159, 803774, 894215, 835206, 868211],
  'RBD PALM STEARIN': [191362, 168112, 201629, 215714, 256592, 232504, 246244, 235200, 220977, 241051, 234897, 245933],
  'PFAD':             [53756, 48903, 57368, 57851, 65921, 61613, 62073, 61280, 59636, 63985, 62493, 64845],
  'COOKING OIL':      [46476, 43465, 44744, 46086, 37429, 40426, 42656, 44280, 37796, 30322, 37969, 44571],
};

const PROD_2026: Record<string, (number | null)[]> = {
  'C.P.STEARIN':      [2470, 2215, 2186, null, null, null, null, null, null, null, null, null],
  'C.P.OLEIN':        [66351, 32415, 66387, null, null, null, null, null, null, null, null, null],
  'RBD PALM OIL':     [1134366, 1029090, 1129180, null, null, null, null, null, null, null, null, null],
  'RBD PALM OLEIN':   [782790, 723498, 788104, null, null, null, null, null, null, null, null, null],
  'RBD PALM STEARIN': [216125, 198479, 229230, null, null, null, null, null, null, null, null, null],
  'PFAD':             [62039, 56362, 59208, null, null, null, null, null, null, null, null, null],
  'COOKING OIL':      [41681, 28507, 38923, null, null, null, null, null, null, null, null, null],
};

// ============ EXPORT BY PORT ============
const EXPORT_PORT_ITEMS = [
  { name: 'BUTTERWORTH', group: 'PEN. MALAYSIA', sort: 1 },
  { name: 'PORT KLANG', group: 'PEN. MALAYSIA', sort: 2 },
  { name: 'PASIR GUDANG', group: 'PEN. MALAYSIA', sort: 3 },
  { name: 'OTHERS (PEN)', group: 'PEN. MALAYSIA', sort: 4 },
  { name: 'PEN. MALAYSIA', group: null, sort: 5 },  // subtotal
  { name: 'LAHAD DATU', group: 'SABAH/SARAWAK', sort: 6 },
  { name: 'SANDAKAN', group: 'SABAH/SARAWAK', sort: 7 },
  { name: 'OTHERS (SS)', group: 'SABAH/SARAWAK', sort: 8 },
  { name: 'SABAH/SARAWAK', group: null, sort: 9 },  // subtotal
  { name: 'MALAYSIA', group: null, sort: 10 },        // grand total
];

const EXPORT_PORT_2026: Record<string, (number | null)[]> = {
  'BUTTERWORTH':      [4977, 11191, 383, null, null, null, null, null, null, null, null, null],
  'PORT KLANG':       [298558, 251423, 278205, null, null, null, null, null, null, null, null, null],
  'PASIR GUDANG':     [208993, 96791, 300117, null, null, null, null, null, null, null, null, null],
  'OTHERS (PEN)':     [205991, 106141, 208250, null, null, null, null, null, null, null, null, null],
  'PEN. MALAYSIA':    [718519, 465547, 786955, null, null, null, null, null, null, null, null, null],
  'LAHAD DATU':       [121301, 114486, 161428, null, null, null, null, null, null, null, null, null],
  'SANDAKAN':         [138471, 117657, 155584, null, null, null, null, null, null, null, null, null],
  'OTHERS (SS)':      [476335, 404897, 447297, null, null, null, null, null, null, null, null, null],
  'SABAH/SARAWAK':    [736107, 637039, 764309, null, null, null, null, null, null, null, null, null],
  'MALAYSIA':         [1454625, 1102587, 1551264, null, null, null, null, null, null, null, null, null],
};

// ============ EXPORT BY PRODUCT ============
const EXPORT_PRODUCT_ITEMS = [
  { name: 'CPO', sort: 1 },
  { name: 'PPO', sort: 2 },
  { name: 'PALM OIL', sort: 3 },
  { name: 'CPKO', sort: 4 },
  { name: 'PPKO', sort: 5 },
  { name: 'PALM KERNEL OIL', sort: 6 },
  { name: 'PALM KERNEL CAKE', sort: 7 },
  { name: 'OLEOCHEMICALS', sort: 8 },
  { name: 'FINISHED PRODUCTS', sort: 9 },
  { name: 'BIODIESEL', sort: 10 },
  { name: 'OTHERS', sort: 11 },
  { name: 'TOTAL', sort: 12 },
];

// [tonnes, rm_mil] per month
const EXPORT_PRODUCT_2026: Record<string, [number | null, number | null][]> = {
  'CPO':               [[406835,1634.12],[307649,1365.07],[254888,1047.87],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'PPO':               [[1047790,4580.37],[794937,3440.35],[1296376,5574.19],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'PALM OIL':          [[1454625,6214.49],[1102587,4805.43],[1551264,6622.06],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'CPKO':              [[3500,24.07],[10494,77.28],[10498,78.30],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'PPKO':              [[51789,415.42],[34906,274.82],[67535,532.76],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'PALM KERNEL OIL':   [[55288,439.49],[45400,352.10],[78033,611.06],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'PALM KERNEL CAKE':  [[247692,136.50],[188746,103.68],[180104,101.80],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'OLEOCHEMICALS':     [[222042,1506.90],[202927,1348.23],[250454,1658.74],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'FINISHED PRODUCTS': [[47435,402.95],[39363,310.32],[38526,321.22],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'BIODIESEL':         [[18776,100.62],[15986,82.89],[12908,67.76],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'OTHERS':            [[368976,483.65],[310054,503.01],[327732,580.22],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
  'TOTAL':             [[2414835,9284.60],[1905063,7505.66],[2439021,9962.86],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]],
};

// ============ BUILD RECORDS ============
export function buildMpobSeedRecords(): MpobRecord[] {
  const records: MpobRecord[] = [];

  // Helper
  const addMonthly = (
    category: string, name: string, year: number,
    values: (number | null)[], sort: number,
    parentGroup?: string | null
  ) => {
    for (let m = 0; m < 12; m++) {
      if (values[m] != null) {
        records.push({
          category, item_name: name, year, month: m + 1,
          value: values[m], sort_order: sort, parent_group: parentGroup ?? null,
        });
      }
    }
  };

  // Stock
  for (const p of STOCK_PRODUCTS) {
    if (STOCK_2025[p.name]) addMonthly('stock', p.name, 2025, STOCK_2025[p.name], p.sort);
    if (STOCK_2026[p.name]) addMonthly('stock', p.name, 2026, STOCK_2026[p.name], p.sort);
  }

  // Production
  for (const p of PROD_PRODUCTS) {
    if (PROD_2025[p.name]) addMonthly('production', p.name, 2025, PROD_2025[p.name], p.sort);
    if (PROD_2026[p.name]) addMonthly('production', p.name, 2026, PROD_2026[p.name], p.sort);
  }

  // Export by Port (2026 only from provided data)
  for (const p of EXPORT_PORT_ITEMS) {
    if (EXPORT_PORT_2026[p.name]) {
      addMonthly('export_port', p.name, 2026, EXPORT_PORT_2026[p.name], p.sort, p.group);
    }
  }

  // Export by Product (2026 only)
  for (const p of EXPORT_PRODUCT_ITEMS) {
    const monthData = EXPORT_PRODUCT_2026[p.name];
    if (!monthData) continue;
    for (let m = 0; m < 12; m++) {
      const [tonnes, rm] = monthData[m];
      if (tonnes != null) {
        records.push({
          category: 'export_product', item_name: p.name, year: 2026, month: m + 1,
          value: tonnes, value_rm: rm, sort_order: p.sort,
        });
      }
    }
  }

  return records;
}
