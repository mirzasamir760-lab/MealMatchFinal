import os
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, session
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import mysql.connector


def get_db():
    return mysql.connector.connect(
        host=os.getenv('DB_HOST', '127.0.0.1'),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASSWORD', ''),
        database=os.getenv('DB_NAME', 'mealmatch'),
        auth_plugin=os.getenv('DB_AUTH_PLUGIN', 'mysql_native_password')
    )


app = Flask(__name__, static_folder=None)
app.secret_key = os.getenv('FLASK_SECRET', 'dev_secret_change_me')
CORS(app, supports_credentials=True)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PUBLIC_DIR = ROOT
UPLOAD_DIR = os.path.join(ROOT, 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)


def row_to_user(row):
    if not row:
        return None
    return {
        'id': row[0],
        'name': row[1],
        'email': row[2],
        'role': row[3],
        'photo_url': row[4]
    }


@app.route('/uploads/<path:filename>')
def uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route('/api/auth/register', methods=['POST'])
def register():
    name = request.form.get('name', '').strip()
    email = request.form.get('email', '').strip().lower()
    password = request.form.get('password', '')
    role = request.form.get('role', 'customer')  # 'customer' | 'owner'
    photo = request.files.get('photo')

    if not name or not email or not password or role not in ('customer', 'owner'):
        return jsonify({'error': 'Invalid data'}), 400

    photo_url = None
    if photo and photo.filename:
        safe_name = f"{int(datetime.utcnow().timestamp())}_{photo.filename}"
        save_path = os.path.join(UPLOAD_DIR, safe_name)
        photo.save(save_path)
        photo_url = f"/uploads/{safe_name}"

    db = get_db()
    cur = db.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE email=%s", (email,))
        if cur.fetchone():
            return jsonify({'error': 'Email already registered'}), 409

        cur.execute(
            "INSERT INTO users(name,email,password_hash,role,photo_url) VALUES(%s,%s,%s,%s,%s)",
            (name, email, generate_password_hash(password), role, photo_url)
        )
        db.commit()
        user_id = cur.lastrowid
        session['uid'] = user_id
        return jsonify({'ok': True})
    finally:
        cur.close(); db.close()


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    db = get_db()
    cur = db.cursor()
    try:
        cur.execute("SELECT id,name,email,role,photo_url,password_hash FROM users WHERE email=%s", (email,))
        row = cur.fetchone()
        if not row or not check_password_hash(row[5], password):
            return jsonify({'error': 'Invalid email or password'}), 401
        session['uid'] = row[0]
        return jsonify({'ok': True})
    finally:
        cur.close(); db.close()


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.pop('uid', None)
    return jsonify({'ok': True})


@app.route('/api/auth/me')
def me():
    uid = session.get('uid')
    if not uid:
        return jsonify({'user': None})
    db = get_db(); cur = db.cursor()
    try:
        cur.execute("SELECT id,name,email,role,photo_url FROM users WHERE id=%s", (uid,))
        row = cur.fetchone()
        return jsonify({'user': row_to_user(row)})
    finally:
        cur.close(); db.close()


@app.route('/api/profile', methods=['GET', 'PUT'])
def profile():
    uid = session.get('uid')
    if not uid:
        return jsonify({'error': 'Not authenticated'}), 401
    if request.method == 'GET':
        db = get_db(); cur = db.cursor()
        try:
            cur.execute("SELECT id,name,email,role,photo_url FROM users WHERE id=%s", (uid,))
            row = cur.fetchone()
            return jsonify({'user': row_to_user(row)})
        finally:
            cur.close(); db.close()
    # PUT for updates (name/password/photo)
    name = request.form.get('name')
    password = request.form.get('password')
    photo = request.files.get('photo')
    photo_url = None
    if photo and photo.filename:
        safe_name = f"{int(datetime.utcnow().timestamp())}_{photo.filename}"
        save_path = os.path.join(UPLOAD_DIR, safe_name)
        photo.save(save_path)
        photo_url = f"/uploads/{safe_name}"
    db = get_db(); cur = db.cursor()
    try:
        if name:
            cur.execute("UPDATE users SET name=%s WHERE id=%s", (name, uid))
        if password:
            cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (generate_password_hash(password), uid))
        if photo_url:
            cur.execute("UPDATE users SET photo_url=%s WHERE id=%s", (photo_url, uid))
        db.commit()
        return jsonify({'ok': True, 'photo_url': photo_url})
    finally:
        cur.close(); db.close()


@app.route('/api/owner/restaurants', methods=['POST'])
def owner_add_restaurant():
    uid = session.get('uid')
    if not uid:
        return jsonify({'error': 'Not authenticated'}), 401
    db = get_db(); cur = db.cursor()
    try:
        cur.execute("SELECT role FROM users WHERE id=%s", (uid,))
        row = cur.fetchone()
        if not row or row[0] != 'owner':
            return jsonify({'error': 'Owner role required'}), 403
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        area = (data.get('area') or '').strip()
        cuisine = (data.get('cuisine') or '').strip()
        price_level = (data.get('price_level') or '¥').strip()
        halal = bool(data.get('halal', False))
        image_url = data.get('image_url')
        if not name:
            return jsonify({'error': 'Name required'}), 400
        cur.execute(
            "INSERT INTO restaurants(owner_id,name,area,cuisine,price_level,halal,image_url) VALUES(%s,%s,%s,%s,%s,%s,%s)",
            (uid, name, area, cuisine, price_level, halal, image_url)
        )
        db.commit()
        return jsonify({'ok': True, 'restaurant_id': cur.lastrowid})
    finally:
        cur.close(); db.close()


@app.route('/api/restaurants')
def list_restaurants():
    q = (request.args.get('q') or '').strip().lower()
    area = request.args.get('area')
    cuisine = request.args.get('cuisine')
    price = request.args.get('price')  # ¥, ¥¥, ¥¥¥
    db = get_db(); cur = db.cursor(dictionary=True)
    try:
        sql = "SELECT id,name,area,cuisine,price_level,halal,image_url FROM restaurants"
        clauses = []
        params = []
        if q:
            clauses.append("LOWER(name) LIKE %s")
            params.append(f"%{q}%")
        if area and area != 'All Areas':
            clauses.append("area=%s"); params.append(area)
        if cuisine and cuisine != 'All Cuisines':
            # Special handling for Halal - check halal attribute instead of cuisine
            if cuisine == 'Halal':
                clauses.append("halal=%s"); params.append(True)
            else:
                clauses.append("cuisine=%s"); params.append(cuisine)
        if price and price != 'All Prices':
            clauses.append("price_level=%s"); params.append(price)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY name"
        cur.execute(sql, tuple(params))
        return jsonify({'restaurants': cur.fetchall()})
    finally:
        cur.close(); db.close()


@app.route('/api/menu/<int:restaurant_id>')
def list_menu(restaurant_id):
    db = get_db(); cur = db.cursor(dictionary=True)
    try:
        cur.execute("SELECT id,name,price,old_price,discount,image_url FROM menu_items WHERE restaurant_id=%s ORDER BY name", (restaurant_id,))
        return jsonify({'items': cur.fetchall()})
    finally:
        cur.close(); db.close()


@app.route('/api/orders', methods=['GET', 'POST'])
def orders():
    uid = session.get('uid')
    if not uid:
        return jsonify({'error': 'Not authenticated'}), 401
    db = get_db(); cur = db.cursor(dictionary=True)
    try:
        if request.method == 'GET':
            cur.execute("SELECT id,status,created_at FROM orders WHERE user_id=%s ORDER BY id DESC", (uid,))
            return jsonify({'orders': cur.fetchall()})
        data = request.get_json(silent=True) or {}
        restaurant_id = data.get('restaurant_id')
        items = data.get('items') or []  # [{menu_item_id, quantity}]
        if not items:
            return jsonify({'error': 'No items'}), 400
        cur2 = db.cursor()
        cur2.execute("INSERT INTO orders(user_id,status,created_at) VALUES(%s,%s,NOW())", (uid, 'pending'))
        order_id = cur2.lastrowid
        for it in items:
            mid = it.get('menu_item_id'); qty = int(it.get('quantity') or 1)
            cur2.execute("SELECT price FROM menu_items WHERE id=%s", (mid,))
            row = cur2.fetchone()
            if not row: continue
            cur2.execute(
                "INSERT INTO order_items(order_id,menu_item_id,quantity,price) VALUES(%s,%s,%s,%s)",
                (order_id, mid, qty, row[0])
            )
        db.commit()
        cur2.close()
        return jsonify({'ok': True, 'order_id': order_id})
    finally:
        cur.close(); db.close()


@app.route('/<path:path>')
def serve_public(path):
    # Serve existing static HTML and assets from project root
    abs_path = os.path.join(PUBLIC_DIR, path)
    if os.path.isdir(abs_path):
        # directory access not expected; fallback
        return send_from_directory(PUBLIC_DIR, 'index.html')
    if os.path.exists(abs_path):
        directory = os.path.dirname(abs_path)
        filename = os.path.basename(abs_path)
        return send_from_directory(directory, filename)
    return send_from_directory(PUBLIC_DIR, 'index.html')


@app.route('/')
def root():
    return send_from_directory(PUBLIC_DIR, 'index.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', '5000')), debug=True)






