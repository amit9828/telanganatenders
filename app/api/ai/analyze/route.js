import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

let cachedClient = null;
let cachedDb = null;
async function getDb() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(process.env.MONGO_URL);
  cachedClient = client;
  cachedDb = client.db(process.env.DB_NAME || 'tender_portal');
  return cachedDb;
}

export async function POST(request) {
  try {
    const { pdfBase64, fileName, mimeType, uploadedBy, saveToDraft } = await request.json();

    if (!pdfBase64) return NextResponse.json({ error: 'PDF data missing' }, { status: 400 });
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: 'GEMINI_API_KEY missing' }, { status: 500 });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
      You are an expert Tender Analyst. Read this document and extract ONLY the following key details. 
      Return the output STRICTLY as a JSON object with these exact keys:
      {
        "bid_no": "Extracted Bid Number or 'N/A'",
        "title": "Short title of the work or 'N/A'",
        "department": "Name of the government department or 'N/A'",
        "last_date": "Last date of submission (YYYY-MM-DD) or 'N/A'",
        "district": "Any mentioned district in TS or AP, else 'N/A'",
        "emd_amount": "EMD Amount in INR or 'N/A'",
        "turnover_req": "Turnover required if any or 'N/A'",
        "mandatory_docs": ["Doc 1", "Doc 2"]
      }
      If a value is not found, return "N/A". Output ONLY valid JSON, no markdown formatting.
    `;

    const documentPart = { inlineData: { data: pdfBase64, mimeType: mimeType || 'application/pdf' } };
    const result = await model.generateContent([prompt, documentPart]);
    const responseText = result.response.text();
    
    let parsedData = {};
    try {
        parsedData = JSON.parse(responseText.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch(e) {
        console.error("JSON Parse Error:", responseText);
        return NextResponse.json({ error: 'AI formatting error' }, { status: 500 });
    }

    if (saveToDraft) {
        // Admin Bulk Upload: Save to database
        const db = await getDb();
        const existing = await db.collection('ai_draft_tenders').findOne({ bid_no: parsedData.bid_no });
        if (existing && parsedData.bid_no !== "N/A") {
            return NextResponse.json({ error: 'Already exists in drafts' }, { status: 409 });
        }
        const draftData = {
            ...parsedData, pdf_filename: fileName, pdf_base64: pdfBase64, status: 'Pending Verification',
            uploaded_by: uploadedBy || 'Admin', created_at: new Date()
        };
        await db.collection('ai_draft_tenders').insertOne(draftData);
        return NextResponse.json({ success: true, data: draftData });
    } else {
        // Employee Single Upload: Just return data to auto-fill
        return NextResponse.json({ success: true, data: parsedData });
    }
  } catch (error) {
    console.error("AI Route Error:", error);
    return NextResponse.json({ error: 'AI Processing Failed' }, { status: 500 });
  }
}
