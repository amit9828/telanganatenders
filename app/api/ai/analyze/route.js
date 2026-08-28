import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { pdfBase64, mimeType } = await request.json();

    if (!pdfBase64) {
      return NextResponse.json({ error: 'PDF data missing' }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'API Key missing in .env' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
      You are an expert Tender Analyst working for "Telangana Tenders". 
      Read this document and extract ONLY the following key details. Do not read unnecessary pages.
      Return the output STRICTLY as a JSON object with these exact keys:
      {
        "bid_no": "Extracted Bid Number or Reference Number",
        "title": "Short title or Name of the work",
        "department": "Name of the government department",
        "last_date": "Last date of submission (YYYY-MM-DD)",
        "emd_amount": "EMD Amount in INR",
        "turnover_req": "Turnover required if any",
        "mandatory_docs": ["Doc 1", "Doc 2"]
      }
      If a value is not found, return "N/A". Output ONLY valid JSON, no markdown formatting like \`\`\`json.
    `;

    const documentPart = {
      inlineData: {
        data: pdfBase64,
        mimeType: mimeType || 'application/pdf',
      },
    };

    const result = await model.generateContent([prompt, documentPart]);
    const responseText = result.response.text();

    const cleanedJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedData = JSON.parse(cleanedJson);

    return NextResponse.json({ success: true, data: parsedData });

  } catch (error) {
    console.error("AI Analysis Error:", error);
    return NextResponse.json({ error: 'Failed to analyze document with AI' }, { status: 500 });
  }
}
