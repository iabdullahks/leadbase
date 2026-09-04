import os
import csv
import io
from flask import Flask, render_template, request, jsonify, Response
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

supabase: Client = create_client(
    os.environ.get("SUPABASE_URL"),
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
)

PAGE_SIZE = 50

# ── Pages ──────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('leads.html')

# ── API: Stats ─────────────────────────────────────────────────────────────────
@app.route('/api/stats')
def api_stats():
    try:
        total_res = supabase.table('carriers').select('usdot_number', count='exact').execute()
        total = total_res.count or 0

        active_res = supabase.table('carriers').select('usdot_number', count='exact').eq('carrier_status', 'Active').execute()
        active = active_res.count or 0

        inactive_res = supabase.table('carriers').select('usdot_number', count='exact').eq('carrier_status', 'Inactive').execute()
        inactive = inactive_res.count or 0

        phone_res = supabase.table('carriers').select('usdot_number', count='exact').neq('phone', '').execute()
        with_phone = phone_res.count or 0

        email_res = supabase.table('carriers').select('usdot_number', count='exact').neq('email', '').execute()
        with_email = email_res.count or 0

        # New today (motus_last_updated today)
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        new_res = supabase.table('carriers').select('usdot_number', count='exact').gte('scraped_at', today).execute()
        new_today = new_res.count or 0

        return jsonify({
            'total': total,
            'active': active,
            'inactive': inactive,
            'with_phone': with_phone,
            'with_email': with_email,
            'new_today': new_today,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ── API: Leads (search + filter + paginate) ────────────────────────────────────
@app.route('/api/leads')
def api_leads():
    try:
        page        = max(int(request.args.get('page', 1)), 1)
        search      = (request.args.get('search', '') or '').strip()
        status      = (request.args.get('status', 'all') or 'all').strip()
        has_phone   = request.args.get('has_phone', '') == '1'
        has_email   = request.args.get('has_email', '') == '1'
        sort_by     = request.args.get('sort', 'scraped_at')
        sort_dir    = request.args.get('dir', 'desc')
        date_from   = (request.args.get('date_from', '') or '').strip()
        date_to     = (request.args.get('date_to', '') or '').strip()

        allowed_sorts = {'usdot_number', 'legal_name', 'carrier_status', 'scraped_at', 'motus_entry_date'}
        if sort_by not in allowed_sorts:
            sort_by = 'scraped_at'
        descending = sort_dir != 'asc'

        offset = (page - 1) * PAGE_SIZE

        # Build query
        q = supabase.table('carriers').select(
            'usdot_number, legal_name, phone, email, carrier_status, out_of_service, scraped_at, motus_entry_date, profile_url',
            count='exact'
        )

        if status and status != 'all':
            q = q.eq('carrier_status', status.capitalize())
        if has_phone:
            q = q.neq('phone', '')
        if has_email:
            q = q.neq('email', '')
        if date_from:
            q = q.gte('scraped_at', date_from)
        if date_to:
            q = q.lte('scraped_at', date_to + 'T23:59:59')
        if search:
            # ilike search on legal_name or usdot_number
            q = q.or_(f'legal_name.ilike.%{search}%,usdot_number.ilike.%{search}%,phone.ilike.%{search}%,email.ilike.%{search}%')

        q = q.order(sort_by, desc=descending).range(offset, offset + PAGE_SIZE - 1)
        res = q.execute()

        total_count = res.count or 0
        total_pages = max((total_count + PAGE_SIZE - 1) // PAGE_SIZE, 1)

        return jsonify({
            'leads': res.data or [],
            'total': total_count,
            'page': page,
            'pages': total_pages,
            'per_page': PAGE_SIZE,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ── API: Export CSV ────────────────────────────────────────────────────────────
@app.route('/api/export')
def api_export():
    try:
        search    = (request.args.get('search', '') or '').strip()
        status    = (request.args.get('status', 'all') or 'all').strip()
        has_phone = request.args.get('has_phone', '') == '1'
        has_email = request.args.get('has_email', '') == '1'
        date_from = (request.args.get('date_from', '') or '').strip()
        date_to   = (request.args.get('date_to', '') or '').strip()

        q = supabase.table('carriers').select(
            'usdot_number, legal_name, phone, email, carrier_status, out_of_service, scraped_at, motus_entry_date, profile_url'
        )
        if status and status != 'all':
            q = q.eq('carrier_status', status.capitalize())
        if has_phone:
            q = q.neq('phone', '')
        if has_email:
            q = q.neq('email', '')
        if date_from:
            q = q.gte('scraped_at', date_from)
        if date_to:
            q = q.lte('scraped_at', date_to + 'T23:59:59')
        if search:
            q = q.or_(f'legal_name.ilike.%{search}%,usdot_number.ilike.%{search}%,phone.ilike.%{search}%,email.ilike.%{search}%')

        # Fetch all matching (up to 10,000)
        all_data = []
        page = 0
        while True:
            batch = q.order('scraped_at', desc=True).range(page * 1000, (page + 1) * 1000 - 1).execute()
            if not batch.data:
                break
            all_data.extend(batch.data)
            if len(batch.data) < 1000:
                break
            page += 1

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=[
            'usdot_number', 'legal_name', 'phone', 'email',
            'carrier_status', 'out_of_service', 'scraped_at',
            'motus_entry_date', 'profile_url'
        ], extrasaction='ignore')
        writer.writeheader()
        writer.writerows(all_data)

        return Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': 'attachment; filename=leads_export.csv'}
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ── API: Single lead detail ────────────────────────────────────────────────────
@app.route('/api/leads/<usdot>')
def api_lead_detail(usdot):
    try:
        res = supabase.table('carriers').select('*').eq('usdot_number', usdot).single().execute()
        return jsonify(res.data or {})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)

