# Repeat Cult — Backend & SQLite Database

This repository is powered by a high-performance **Node.js + Express** backend integrated with an embedded **SQLite** database (`better-sqlite3`). It manages batch drop subscribers, waitlists, and notification queues with zero cloud setup needed.

---

## ⚡ Quick Start

### 1. Start the Server
```bash
npm start
```
Or for development with automatic restart:
```bash
npm run dev
```

### 2. Access the Application
- **Storefront**: [http://localhost:3000](http://localhost:3000)
- **Database & Drops Admin Portal**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **API Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

---

## 💾 Database Architecture

The database is stored locally in `data/repeatcult.db`. SQLite runs in **WAL (Write-Ahead Logging)** mode for maximum speed and safe concurrent operations.

### Schema: `subscribers`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INTEGER PRIMARY KEY` | Auto-incrementing unique subscriber ID |
| `email` | `TEXT UNIQUE` | Case-insensitive subscriber email address |
| `status` | `TEXT` | `'active'` or `'unsubscribed'` |
| `source` | `TEXT` | Form source (e.g., `website_footer`, `batch_002_waitlist`) |
| `created_at` | `TEXT` | ISO 8601 registration timestamp |
| `updated_at` | `TEXT` | Last updated timestamp |
| `ip_address` | `TEXT` | Client IP address |
| `user_agent` | `TEXT` | Browser User-Agent header |

---

## 🔌 REST API Endpoints

### 1. Subscribe to Drop Waitlist
- **Endpoint**: `POST /api/newsletter/subscribe`
- **Request Body**:
  ```json
  {
    "email": "customer@example.com",
    "source": "website_footer"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "alreadySubscribed": false,
    "message": "Locked in! You're on the list for the next batch drop.",
    "subscriber": {
      "id": 1,
      "email": "customer@example.com",
      "status": "active",
      "created_at": "2026-10-13T07:45:00.000Z"
    }
  }
  ```

### 2. List Subscribers
- **Endpoint**: `GET /api/newsletter/subscribers?search=&status=&limit=100&offset=0`
- **Response**:
  ```json
  {
    "success": true,
    "total": 1,
    "count": 1,
    "subscribers": [...]
  }
  ```

### 3. Export Subscribers (CSV)
- **Endpoint**: `GET /api/newsletter/export`
- **Output**: Returns a downloadable `repeat_cult_subscribers.csv` file ready for import into Mailchimp, Klaviyo, SendGrid, or Excel.

### 4. Unsubscribe
- **Endpoint**: `POST /api/newsletter/unsubscribe`
- **Request Body**:
  ```json
  { "email": "customer@example.com" }
  ```

### 5. Delete Subscriber
- **Endpoint**: `DELETE /api/newsletter/subscribers/:id`

### 6. Summary Stats
- **Endpoint**: `GET /api/stats`
- Returns count of total, active, and unsubscribed users.

---

## 📁 File Structure

```text
REPEAT CULT/
├── data/
│   └── repeatcult.db       # Embedded SQLite database (auto-created)
├── admin.html              # Dedicated brutalist Admin & Database portal
├── db.js                   # SQLite database configuration and queries
├── index.HTML              # Main storefront HTML
├── package.json            # Node.js project manifest and scripts
├── script.JS               # Client JavaScript connected to the API
├── server.js               # Express REST API server & static file host
├── style.CSS               # Site design & responsive stylesheet
└── README.md               # Documentation
```
