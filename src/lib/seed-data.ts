import fs from 'fs';
import path from 'path';
import { dbBatchRun, dbGet, dbRun, dbAll } from './db';
import { recalcInventory } from './inventory-calc';

interface PriceRecord {
  date: string;
  contract_month: string;
  settlement_usd: number;
}

interface InventoryRecord {
  product: string;
  year: number;
  month: number;
  field: string;
  value: any;
}

interface PurchaseRecord {
  shipment_month: string;
  contract_date: string;
  contract_price: number;
  market_price: number;
  price_diff: number;
  prebuy_effect_krw: number;
  evaluation: string;
  notes?: string;
}

export async function seedInitialData() {
  // Check if already seeded
  const count = await dbGet('SELECT COUNT(*) as cnt FROM inventory') as { cnt: number } | undefined;
  if (count && count.cnt > 0) return;

  try {
    // Load JSON data
    const priceDataPath = path.join(process.cwd(), 'data', 'price_db_import.json');
    const inventoryDataPath = path.join(process.cwd(), 'data', 'inventory_import.json');
    const purchasesDataPath = path.join(process.cwd(), 'data', 'purchases_import.json');

    const priceData: PriceRecord[] = JSON.parse(fs.readFileSync(priceDataPath, 'utf-8'));
    const inventoryData: InventoryRecord[] = JSON.parse(fs.readFileSync(inventoryDataPath, 'utf-8'));
    const purchasesData: PurchaseRecord[] = JSON.parse(fs.readFileSync(purchasesDataPath, 'utf-8'));

    console.log(`Loading ${priceData.length} price records...`);
    console.log(`Loading ${inventoryData.length} inventory records...`);
    console.log(`Loading ${purchasesData.length} purchase records...`);

    // Import FCPO price data in batches
    const priceOps = priceData.map(p => ({
      sql: `INSERT INTO fcpo_settlement (date, contract_month, settlement_usd, source)
            VALUES (?, ?, ?, 'excel_import')
            ON CONFLICT (date, contract_month) DO NOTHING`,
      params: [p.date, p.contract_month, p.settlement_usd]
    }));

    // Insert prices in batches of 500
    console.log('Importing price data...');
    for (let i = 0; i < priceOps.length; i += 500) {
      const batch = priceOps.slice(i, Math.min(i + 500, priceOps.length));
      await dbBatchRun(batch);
      console.log(`  Imported ${Math.min(i + 500, priceOps.length)}/${priceOps.length} price records`);
    }

    // Import inventory data
    console.log('Importing inventory data...');

    // First pass: create inventory records for each product/year/month combination
    const inventoryKeys = new Set<string>();
    const inventoryOps: { sql: string; params: any[] }[] = [];

    for (const record of inventoryData) {
      const key = `${record.product}|${record.year}|${record.month}`;
      if (!inventoryKeys.has(key)) {
        inventoryKeys.add(key);
        inventoryOps.push({
          sql: `INSERT INTO inventory (product, year, month, updated_by)
                VALUES (?, ?, ?, 'excel_import')
                ON CONFLICT (product, year, month) DO NOTHING`,
          params: [record.product, record.year, record.month]
        });
      }
    }

    // Insert inventory rows in batches
    for (let i = 0; i < inventoryOps.length; i += 100) {
      const batch = inventoryOps.slice(i, Math.min(i + 100, inventoryOps.length));
      await dbBatchRun(batch);
    }
    console.log(`  Created ${inventoryKeys.size} inventory records`);

    // Second pass: update inventory fields
    const updateOps: { sql: string; params: any[] }[] = [];

    for (const record of inventoryData) {
      const fieldName = record.field;
      // Skip ending_stock and coverage_days as these are calculated
      if (fieldName === 'ending_stock' || fieldName === 'coverage_days') {
        continue;
      }

      updateOps.push({
        sql: `UPDATE inventory SET ${fieldName} = ?, updated_by = 'excel_import', updated_at = NOW()
              WHERE product = ? AND year = ? AND month = ?`,
        params: [record.value, record.product, record.year, record.month]
      });
    }

    // Update inventory fields in batches
    for (let i = 0; i < updateOps.length; i += 100) {
      const batch = updateOps.slice(i, Math.min(i + 100, updateOps.length));
      await dbBatchRun(batch);
    }
    console.log(`  Updated ${updateOps.length} inventory fields`);

    // Import purchase data
    console.log('Importing purchase data...');
    const purchaseOps = purchasesData.map(p => {
      // Extract date from contract_date (handle both formats)
      let contractDate = p.contract_date;
      if (contractDate && contractDate.includes(' ')) {
        contractDate = contractDate.split(' ')[0];
      }

      // Clean up evaluation field
      let evaluation = p.evaluation?.trim() || null;
      if (evaluation) {
        evaluation = evaluation.replace(/\n/g, ' ').trim();
        // Only keep valid evaluation values
        if (!['성공', '실패'].includes(evaluation)) {
          // If it contains Korean text, try to extract the main evaluation
          if (evaluation.includes('성공')) {
            evaluation = '성공';
          } else if (evaluation.includes('실패')) {
            evaluation = '실패';
          } else {
            evaluation = null;
          }
        }
      }

      return {
        sql: `INSERT INTO purchases (shipment_month, contract_date, contract_price, market_price, price_diff, prebuy_effect_krw, evaluation, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [p.shipment_month, contractDate, p.contract_price, p.market_price, p.price_diff, p.prebuy_effect_krw, evaluation, p.notes || null]
      };
    });

    // Insert purchases in batches
    for (let i = 0; i < purchaseOps.length; i += 50) {
      const batch = purchaseOps.slice(i, Math.min(i + 50, purchaseOps.length));
      await dbBatchRun(batch);
    }
    console.log(`  Imported ${purchaseOps.length} purchase records`);

    // Recalculate inventory for all product/year combinations
    console.log('Recalculating inventory...');

    // Get all unique product/year combinations from inventory
    const combinations = await dbAll(`
      SELECT DISTINCT product, year FROM inventory ORDER BY product, year
    `) as { product: string; year: number }[];

    if (combinations && combinations.length > 0) {
      for (const combo of combinations) {
        const product = combo.product as 'RBD' | 'RSPO' | 'MANAGED';
        // For 2025 data, use assumed starting stock values
        if (product === 'RBD' && combo.year === 2025) {
          await recalcInventory(product, combo.year, 2418776);
        } else if (product === 'RSPO' && combo.year === 2025) {
          await recalcInventory(product, combo.year, 1382975);
        } else {
          await recalcInventory(product, combo.year);
        }
      }
    }

    console.log('Seed data import completed successfully');
  } catch (e) {
    console.error('Seed data error:', e);
    throw e;
  }
}
