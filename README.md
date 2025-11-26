# Order Management System (React + Node)

## Tech Stack

- Backend: Node.js, Express, Sequelize, SQLite, JWT
- Frontend: React, Vite, Axios, React Router
- Auth: Email + Password, JWT

## Features

- JWT-based authentication
- Product management (create, edit, enable/disable)
- Promotion management
  - Percentage, fixed, and weighted promotions
  - Weighted promotions use slabs (min/max weight and discount per 500g)
- Order management
  - Per-item discount
  - Subtotal, total discount, grand total

## Running without Docker

### Backend

```bash
cd backend
cp .env.example .env   # edit if needed
npm install
npm run dev
```

Then seed an admin user (once):

```bash
curl -X POST http://localhost:4000/api/auth/seed-admin \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@test.com","password":"123456"}'
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and login:

- Email: `admin@test.com`
- Password: `123456`

## Running with Docker

```bash
docker-compose up --build
```

- Backend: http://localhost:4000
- Frontend: http://localhost:5173

## Promotion Rules

- Only enabled promotions where `start_date <= today <= end_date` are applied.
- Promotions are global (apply to all products).
- If multiple promotions match an item, the **largest discount** is chosen.
- Weighted promotions:
  - Each promotion has multiple slabs: `min_weight_gm`, `max_weight_gm`, `discount_per_500gm`.
  - For a cart item:
    - `total_weight_gm = product_weight_gm * quantity`
    - pick slab where `min <= total_weight_gm <= max`
    - `units = total_weight_gm / 500`
    - `discount = units * discount_per_500gm`.

## Notes

This is a reference implementation for the home task.  
You can extend the UI/logic further or polish styling as desired.
