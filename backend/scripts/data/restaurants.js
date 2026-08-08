/**
 * Dhaka restaurant seed catalog — pure data, no logic. The seeder imports
 * this file; adding a restaurant here (or importing via CSV in Phase 3.5)
 * requires zero code changes.
 *
 * Prices are in Bangladeshi Taka (৳) and weights in grams.
 */

export const RESTAURANT_SEEDS = [
  {
    name: "KFC Dhaka",
    slug: "kfc-dhaka",
    description: "World-famous fried chicken, freshly served.",
    categoryDefaults: [
      { name: 'Chicken', sort_order: 0 },
      { name: 'Burgers', sort_order: 1 },
      { name: 'Sides', sort_order: 2 },
      { name: 'Combos', sort_order: 3 },
    ],
    items: [
      { name: 'Hot & Crispy Chicken (2 pc)', price: 320, weight_gm: 350, description: 'Signature crispy fried chicken pieces', category: 'Chicken', prep_minutes: 12 },
      { name: 'Zinger Burger', price: 260, weight_gm: 280, description: 'Crispy chicken fillet, mayo, fresh lettuce', category: 'Burgers', prep_minutes: 8, variants: [{ name: 'Regular', price_adjustment: 0 }, { name: 'Large', price_adjustment: 80 }] },
      { name: 'Classic Fries', price: 150, weight_gm: 180, description: 'Golden crispy french fries', category: 'Sides', prep_minutes: 5, variants: [{ name: 'Regular', price_adjustment: 0 }, { name: 'Large', price_adjustment: 60 }] },
      { name: 'Colonel Combo', price: 620, weight_gm: 900, description: '2 pc chicken, fries, drink & a zinger wing', category: 'Combos', prep_minutes: 15 },
      { name: 'Mashed Potato with Gravy', price: 120, weight_gm: 200, description: 'Creamy mashed potato with hot gravy', category: 'Sides', prep_minutes: 6 },
      { name: 'Chicken Popcorn (Regular)', price: 180, weight_gm: 160, description: 'Bite-sized crispy chicken pops', category: 'Chicken', prep_minutes: 7, variants: [{ name: 'Regular', price_adjustment: 0 }, { name: 'Large', price_adjustment: 70 }], addons: [{ name: 'Extra Dip', price: 40 }, { name: 'Cheese Sauce', price: 60 }] },
    ],
  },
  {
    name: 'Pizza Hut Dhaka',
    slug: 'pizza-hut-dhaka',
    description: 'Hand-tossed pizzas baked in stone ovens.',
    categoryDefaults: [
      { name: 'Pizza', sort_order: 0 },
      { name: 'Sides', sort_order: 1 },
      { name: 'Desserts', sort_order: 2 },
    ],
    items: [
      { name: 'Margherita (Medium)', price: 650, weight_gm: 600, description: 'Tomato sauce, mozzarella, basil', category: 'Pizza', prep_minutes: 18 },
      { name: 'Pepperoni Feast (Large)', price: 1150, weight_gm: 1000, description: 'Loaded pepperoni with extra cheese', category: 'Pizza', prep_minutes: 20 },
      { name: 'Chicken Supreme (Medium)', price: 980, weight_gm: 650, description: 'Grilled chicken, capsicum, onion, mushroom', category: 'Pizza', prep_minutes: 18, variants: [{ name: 'Medium', price_adjustment: 0 }, { name: 'Large', price_adjustment: 250 }], addons: [{ name: 'Extra Cheese', price: 120 }, { name: 'Extra Topping', price: 150 }] },
      { name: 'Garlic Breadsticks', price: 280, weight_gm: 300, description: 'Oven-baked with garlic butter', category: 'Sides', prep_minutes: 10 },
      { name: 'Spicy Chicken Wings (6 pc)', price: 420, weight_gm: 350, description: 'Tossed in tangy buffalo sauce', category: 'Sides', prep_minutes: 12 },
      { name: 'Choco Lava Cake', price: 220, weight_gm: 120, description: 'Warm chocolate molten cake', category: 'Desserts', prep_minutes: 8 },
    ],
  },
  {
    name: "Domino's Pizza",
    slug: 'dominos-pizza',
    description: 'Hot pizza delivered fast, 30 minutes or free.',
    categoryDefaults: [
      { name: 'Pizza', sort_order: 0 },
      { name: 'Sides', sort_order: 1 },
      { name: 'Desserts', sort_order: 2 },
    ],
    items: [
      { name: 'Veggie Lover (Medium)', price: 590, weight_gm: 550, description: 'Onion, capsicum, tomato, mushroom', category: 'Pizza', prep_minutes: 15 },
      { name: 'Chicken Tikka (Large)', price: 1050, weight_gm: 950, description: 'Spiced chicken tikka, onion, jalapeño', category: 'Pizza', prep_minutes: 20 },
      { name: 'BBQ Chicken (Medium)', price: 890, weight_gm: 600, description: 'Smoky BBQ chicken, red onion', category: 'Pizza', prep_minutes: 15, variants: [{ name: 'Medium', price_adjustment: 0 }, { name: 'Large', price_adjustment: 220 }] },
      { name: 'Garlic Cheese Bread', price: 260, weight_gm: 280, description: 'Cheese-filled bread with garlic dip', category: 'Sides', prep_minutes: 9 },
      { name: 'Choco Chunk Cookie', price: 180, weight_gm: 100, description: 'Warm, gooey chocolate chunk cookie', category: 'Desserts', prep_minutes: 6 },
    ],
  },
  {
    name: 'Chillox',
    slug: 'chillox',
    description: "Dhaka's favourite gourmet smash burgers.",
    categoryDefaults: [
      { name: 'Burgers', sort_order: 0 },
      { name: 'Sides', sort_order: 1 },
      { name: 'Drinks', sort_order: 2 },
    ],
    items: [
      { name: 'Chillox Beef Burger', price: 380, weight_gm: 420, description: 'Smash beef patty, secret sauce, pickles', category: 'Burgers', prep_minutes: 12 },
      { name: 'Naga Blast Burger', price: 410, weight_gm: 430, description: 'Fiery naga-mayo, beef patty, jalapeños', category: 'Burgers', prep_minutes: 12, variants: [{ name: 'Single', price_adjustment: 0 }, { name: 'Double', price_adjustment: 140 }] },
      { name: 'Classic Fries with Cheese', price: 180, weight_gm: 250, description: 'Loaded fries with cheddar sauce', category: 'Sides', prep_minutes: 7 },
      { name: 'BBQ Chicken Wrap', price: 320, weight_gm: 380, description: 'Grilled chicken, BBQ sauce, fresh veggies', category: 'Burgers', prep_minutes: 10 },
      { name: 'Thickshake (Chocolate)', price: 240, weight_gm: 400, description: 'Rich hand-spun chocolate shake', category: 'Drinks', prep_minutes: 6, addons: [{ name: 'Extra Whipped Cream', price: 40 }] },
    ],
  },
  {
    name: 'Takeout',
    slug: 'takeout-dhaka',
    description: 'Contemporary casual dining & desserts.',
    items: [
      { name: 'Steak with Mushroom Sauce', price: 890, weight_gm: 550, description: 'Grilled beef steak, creamy mushroom sauce' },
      { name: 'Chicken Nachos', price: 420, weight_gm: 400, description: 'Loaded nachos with cheese & salsa' },
      { name: 'Fettuccine Alfredo', price: 520, weight_gm: 450, description: 'Creamy pasta with grilled chicken' },
      { name: 'Signature Cheesecake', price: 260, weight_gm: 150, description: 'Baked NY-style cheesecake' },
      { name: 'Lemon Mint Cooler', price: 160, weight_gm: 350, description: 'Refreshing mint-lime cooler' },
    ],
  },
  {
    name: "Sultan's Dine",
    slug: 'sultans-dine',
    description: 'Legendary Kacchi for the true gourmand.',
    categoryDefaults: [
      { name: 'Rice Dishes', sort_order: 0 },
      { name: 'Grills', sort_order: 1 },
      { name: 'Drinks', sort_order: 2 },
    ],
    items: [
      { name: 'Kacchi (1 plate)', price: 450, weight_gm: 600, description: 'Fragrant basmati with mutton & potato', category: 'Rice Dishes', prep_minutes: 20, variants: [{ name: '1 Plate', price_adjustment: 0 }, { name: '1.5 Plate', price_adjustment: 200 }] },
      { name: 'Chicken Roast', price: 320, weight_gm: 350, description: 'Slow-roasted whole chicken leg', category: 'Grills', prep_minutes: 15 },
      { name: 'Beef Tehari', price: 380, weight_gm: 550, description: 'Spiced beef with aromatic rice', category: 'Rice Dishes', prep_minutes: 18 },
      { name: 'Borhani', price: 80, weight_gm: 250, description: 'Traditional minty yogurt drink', category: 'Drinks', prep_minutes: 3 },
      { name: 'Chicken Kacchi (1 plate)', price: 350, weight_gm: 550, description: 'Kacchi with tender chicken', category: 'Rice Dishes', prep_minutes: 20 },
    ],
  },
  {
    name: 'Star Kabab',
    slug: 'star-kabab',
    description: 'Street-food legend since 1982.',
    items: [
      { name: 'Chicken Tikka (2 pc)', price: 240, weight_gm: 300, description: 'Charcoal-grilled chicken tikka' },
      { name: 'Beef Seekh Kabab', price: 280, weight_gm: 320, description: 'Spiced minced beef seekh kabab' },
      { name: 'Chicken Chaap', price: 260, weight_gm: 300, description: 'Slow-cooked chicken in rich gravy' },
      { name: 'Paratha', price: 40, weight_gm: 120, description: 'Flaky layered flatbread' },
      { name: 'Shami Kabab', price: 180, weight_gm: 250, description: 'Crispy lentil-beef kabab' },
    ],
  },
  {
    name: 'Madchef',
    slug: 'madchef',
    description: 'Craft burgers with bold flavours.',
    items: [
      { name: 'Mad Cheese Burger', price: 360, weight_gm: 400, description: 'Double cheese smash burger' },
      { name: 'Spicy Chicken Burger', price: 300, weight_gm: 380, description: 'Crispy chicken, spicy mayo' },
      { name: 'Loaded Potato Wedges', price: 190, weight_gm: 300, description: 'Wedges with cheese & herbs' },
      { name: 'Chicken Shawarma Wrap', price: 290, weight_gm: 350, description: 'Shawarma with garlic sauce' },
    ],
  },
  {
    name: 'Cheez',
    slug: 'cheez-bd',
    description: 'Pizza with the perfect cheese pull.',
    items: [
      { name: 'Cheez Special (Medium)', price: 720, weight_gm: 650, description: 'Signature loaded cheese pizza' },
      { name: 'Chicken BBQ (Large)', price: 1090, weight_gm: 980, description: 'BBQ chicken, onion, capsicum' },
      { name: 'Cheesy Stuffed Crust (Medium)', price: 940, weight_gm: 750, description: 'Crust stuffed with molten cheese' },
      { name: 'Chicken Wings (8 pc)', price: 480, weight_gm: 450, description: 'Crispy wings with honey glaze' },
    ],
  },
  {
    name: 'Herfy',
    slug: 'herfy-bd',
    description: 'Lebanese-Saudi style fast food.',
    items: [
      { name: 'Herfy Beef Burger', price: 280, weight_gm: 330, description: 'Grilled beef patty, special sauce' },
      { name: 'Chicken Shawarma Plate', price: 340, weight_gm: 400, description: 'Shawarma with rice & salad' },
      { name: 'Falafel Wrap', price: 220, weight_gm: 300, description: 'Crispy falafel, tahini, fresh veggies' },
      { name: 'Labneh with Pita', price: 180, weight_gm: 250, description: 'Creamy strained yogurt dip' },
    ],
  },
  {
    name: 'BFC',
    slug: 'bfc-dhaka',
    description: 'Bangladeshi fried chicken, crunchy to the bone.',
    items: [
      { name: 'BFC Chicken (2 pc)', price: 290, weight_gm: 340, description: 'Crispy fried chicken with spicy coating' },
      { name: 'BFC Burger', price: 230, weight_gm: 280, description: 'Crispy fillet burger with mayo' },
      { name: 'French Fries', price: 140, weight_gm: 200, description: 'Salted crispy fries' },
      { name: 'Chicken Popcorn', price: 170, weight_gm: 180, description: 'Popcorn chicken bites' },
    ],
  },
  {
    name: 'Barcode',
    slug: 'barcode-restaurant',
    description: 'Trendy café with all-day dining.',
    items: [
      { name: 'Beef Steak (Pepper)', price: 950, weight_gm: 600, description: 'Sizzling pepper steak with fries' },
      { name: 'Chicken Alfredo Pasta', price: 540, weight_gm: 480, description: 'Creamy alfredo with grilled chicken' },
      { name: 'Club Sandwich', price: 380, weight_gm: 400, description: 'Triple-decker club with fries' },
      { name: 'Irish Coffee', price: 260, weight_gm: 300, description: 'Coffee with whiskey cream' },
    ],
  },
  {
    name: 'American Burger',
    slug: 'american-burger',
    description: 'Big, juicy, all-American smash burgers.',
    items: [
      { name: 'Double Smash Burger', price: 420, weight_gm: 480, description: 'Two smash patties, cheddar, special sauce' },
      { name: 'Bacon Cheese Burger', price: 460, weight_gm: 500, description: 'Crispy bacon, melted cheese' },
      { name: 'Crispy Chicken Burger', price: 310, weight_gm: 400, description: 'Buttermilk fried chicken' },
      { name: 'Loaded Nachos', price: 350, weight_gm: 420, description: 'Nachos with beef chilli & cheese' },
    ],
  },
  {
    name: 'Secret Recipe',
    slug: 'secret-recipe',
    description: 'Cakes & comfort food, a family favourite.',
    items: [
      { name: 'Chocolate Indulgence Cake', price: 320, weight_gm: 150, description: 'Rich layered chocolate cake' },
      { name: 'Grilled Chicken Chop', price: 480, weight_gm: 450, description: 'Grilled chicken with rice & coleslaw' },
      { name: 'Chicken Lasagna', price: 560, weight_gm: 500, description: 'Baked lasagna with creamy béchamel' },
      { name: 'Mango Mousse Cake', price: 300, weight_gm: 140, description: 'Light mango mousse on sponge' },
    ],
  },
  {
    name: 'Handi',
    slug: 'handi-dhaka',
    description: 'Authentic deshi food in clay pots.',
    items: [
      { name: 'Mutton Handi', price: 560, weight_gm: 550, description: 'Slow-cooked mutton curry in clay handi' },
      { name: 'Chicken Handi', price: 420, weight_gm: 500, description: 'Rich chicken curry with spices' },
      { name: 'Butter Naan', price: 80, weight_gm: 150, description: 'Fluffy naan brushed with butter' },
      { name: 'Kheer', price: 140, weight_gm: 200, description: 'Traditional rice pudding' },
    ],
  },
  {
    name: 'La Mode',
    slug: 'la-mode-dhaka',
    description: 'Continental café & bakery.',
    items: [
      { name: 'Steak Sandwich', price: 460, weight_gm: 450, description: 'Sliced steak, grilled onion, mustard mayo' },
      { name: 'Chicken Caesar Salad', price: 420, weight_gm: 400, description: 'Grilled chicken, romaine, parmesan' },
      { name: 'Blueberry Cheesecake', price: 280, weight_gm: 160, description: 'Creamy cheesecake with blueberry glaze' },
      { name: 'Cappuccino', price: 200, weight_gm: 250, description: 'Classic Italian cappuccino' },
    ],
  },
  {
    name: 'Shake Shack Bangla',
    slug: 'shake-shack-bangla',
    description: 'Shakes, fries, and crispy chicken.',
    items: [
      { name: 'Oreo Thickshake', price: 260, weight_gm: 450, description: 'Oreo blended thick shake' },
      { name: 'Mango Shake', price: 220, weight_gm: 450, description: 'Fresh Alphonso mango shake' },
      { name: 'Chicken Strips (5 pc)', price: 300, weight_gm: 320, description: 'Crispy chicken strips with dip' },
      { name: 'Cheese Fries', price: 200, weight_gm: 280, description: 'Fries smothered in cheese sauce' },
    ],
  },
  {
    name: 'Bella Italia',
    slug: 'bella-italia',
    description: 'Wood-fired Italian kitchen.',
    items: [
      { name: 'Quattro Formaggi (Medium)', price: 890, weight_gm: 620, description: 'Four cheese pizza, wood-fired' },
      { name: 'Spaghetti Bolognese', price: 540, weight_gm: 500, description: 'Classic beef bolognese pasta' },
      { name: 'Tiramisu', price: 260, weight_gm: 160, description: 'Espresso-soaked Italian dessert' },
      { name: 'Bruschetta', price: 320, weight_gm: 280, description: 'Toasted bread, tomato, basil' },
    ],
  },
  {
    name: 'Tokyo House',
    slug: 'tokyo-house',
    description: 'Japanese & Korean favourites.',
    items: [
      { name: 'Chicken Katsu Rice', price: 520, weight_gm: 550, description: 'Crispy katsu with Japanese rice' },
      { name: 'Salmon Nigiri (4 pc)', price: 680, weight_gm: 200, description: 'Fresh salmon over seasoned rice' },
      { name: 'Beef Ramen', price: 590, weight_gm: 650, description: 'Rich tonkotsu broth, sliced beef' },
      { name: 'Gyoza (6 pc)', price: 320, weight_gm: 240, description: 'Pan-fried pork dumplings' },
    ],
  },
  {
    name: 'Gloria Jean\'s',
    slug: 'gloria-jeans',
    description: 'Specialty coffee & desserts.',
    items: [
      { name: 'Caffe Latte', price: 240, weight_gm: 300, description: 'Espresso with steamed milk' },
      { name: 'Caramel Frappe', price: 300, weight_gm: 400, description: 'Iced caramel blended coffee' },
      { name: 'Chicken Panini', price: 380, weight_gm: 320, description: 'Grilled panini with pesto chicken' },
      { name: 'Red Velvet Slice', price: 260, weight_gm: 140, description: 'Classic red velvet with cream cheese' },
    ],
  },
];

/**
 * Per-tenant brand themes (Phase 4 R3) — the storefront themes itself from
 * `settings.brand`. Keyed by restaurant slug; the seeder merges this into
 * each tenant's settings (never clobbering merchant customisations).
 */
export const RESTAURANT_BRANDS = {
  'kfc-dhaka': {
    primaryColor: '#e4002b',
    accentColor: '#ffd400',
    tagline: 'It’s finger lickin’ good — fresh in Dhaka',
  },
  'pizza-hut-dhaka': {
    primaryColor: '#d3112a',
    accentColor: '#f5b81b',
    tagline: 'Hot, fresh pizza delivered to your door',
  },
  'dominos-pizza': {
    primaryColor: '#0b5ca8',
    accentColor: '#e31837',
    tagline: 'Delivering hot pizza in 30 minutes or free',
  },
  chillox: {
    primaryColor: '#f26522',
    accentColor: '#ffc800',
    tagline: 'Dhaka’s original smash-burger joint',
  },
  'takeout-dhaka': {
    primaryColor: '#00b3a5',
    accentColor: '#f5d300',
    tagline: 'Your neighbourhood favourites, one tap away',
  },
  'sultans-dine': {
    primaryColor: '#7b3f00',
    accentColor: '#e8a33d',
    tagline: 'Kacchi & Mughlai, the way it should be',
  },
  'star-kabab': {
    primaryColor: '#c8102e',
    accentColor: '#ffd700',
    tagline: 'Sheekh kabab & chaap, grilled to perfection',
  },
  madchef: {
    primaryColor: '#e23744',
    accentColor: '#ffd500',
    tagline: 'Burgers with an attitude',
  },
  'cheez-bd': {
    primaryColor: '#f7a600',
    accentColor: '#7a1e1e',
    tagline: 'Slabs of molten cheesy goodness',
  },
  'herfy-bd': {
    primaryColor: '#e4002b',
    accentColor: '#f5c518',
    tagline: 'Saudi-style burgers, now in Dhaka',
  },
  'bfc-dhaka': {
    primaryColor: '#c8102e',
    accentColor: '#ffc72c',
    tagline: 'Crispy chicken, big flavour',
  },
  'barcode-restaurant': {
    primaryColor: '#111827',
    accentColor: '#22d3c2',
    tagline: 'Gourmet café by day, dinner house by night',
  },
  'american-burger': {
    primaryColor: '#d21034',
    accentColor: '#f5d300',
    tagline: 'Classic American smash burgers',
  },
  'secret-recipe': {
    primaryColor: '#b4302e',
    accentColor: '#f2a93b',
    tagline: 'Asian fusion with a secret twist',
  },
  'handi-dhaka': {
    primaryColor: '#c96f0a',
    accentColor: '#6b2d14',
    tagline: 'Slow-cooked handi classics',
  },
  'la-mode-dhaka': {
    primaryColor: '#8e2de2',
    accentColor: '#ff8fd0',
    tagline: 'Desserts & brunch, beautifully plated',
  },
  'shake-shack-bangla': {
    primaryColor: '#f5a623',
    accentColor: '#7ac142',
    tagline: 'Shakes, burgers & flat-top fries',
  },
  'bella-italia': {
    primaryColor: '#1d7a3e',
    accentColor: '#e11d48',
    tagline: 'Wood-fired pizza, true Italian style',
  },
  'tokyo-house': {
    primaryColor: '#b91c1c',
    accentColor: '#111111',
    tagline: 'Ramen, sushi & izakaya bites',
  },
  'gloria-jeans': {
    primaryColor: '#5b1e2e',
    accentColor: '#e2a84d',
    tagline: 'Specialty coffee, roasted for you',
  },
};
