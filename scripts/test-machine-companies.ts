import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  try {
    const res = await fetch(process.env.MACHINE_API_BASE_URL + '/api/integracao/empresa', {
      headers: {
        'api-key': process.env.MACHINE_API_KEY!,
        'Authorization': 'Basic ' + Buffer.from(process.env.MACHINE_USERNAME + ':' + process.env.MACHINE_PASSWORD).toString('base64'),
        'Content-Type': 'application/json'
      }
    });
    const d = await res.json();
    const list = d.response || d;
    console.log('Total in Machine API:', Array.isArray(list) ? list.length : 'not array');
    if (Array.isArray(list) && list.length > 0) {
      console.log('Sample:', list[0]);
    }
  } catch(e) {
    console.error(e);
  }
}
check();
