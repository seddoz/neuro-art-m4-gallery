// Offline fallback so the gallery still renders when the proxy/API key or
// network is unavailable (e.g. local dev before the key is set). The three
// acceptance IDs are included; at runtime the app prefers live API data.
export const MOCK_PAINTINGS = [
  {
    ID: 282910,
    Title: 'Krakow',
    Artist: 'Alfred Aniol',
    Width: '70', Height: '70', Depth: '2',
    Photo: 'https://www.ahg36.com/wp-content/uploads/2026/05/06052026-1778068244-1-scaled.jpg',
    Category: 'Art Scenes from Krakow', Collection: 'Impressionist',
    Location: 'Abstract', Object_type: 'Painting', Decades: '2010-2020',
    Technique: 'Oil on canvas', Year: '2026',
    Price: { PLN: 1500, USD: 412, EUR: 354 }, Status: 'available'
  },
  {
    ID: 282953,
    Title: 'Evening Light',
    Artist: 'Maria Kowalska',
    Width: '120', Height: '80', Depth: '3',
    Photo: 'https://picsum.photos/seed/282953/1200/800',
    Category: 'Landscape', Collection: 'Modern',
    Location: 'Warsaw', Object_type: 'Painting', Decades: '2010-2020',
    Technique: 'Acrylic', Year: '2025',
    Price: { PLN: 2200, USD: 600, EUR: 520 }, Status: 'available'
  },
  {
    ID: 282966,
    Title: 'Quiet Harbour',
    Artist: 'Jan Nowak',
    Width: '60', Height: '90', Depth: '2',
    Photo: 'https://picsum.photos/seed/282966/900/1350',
    Category: 'Seascape', Collection: 'Classic',
    Location: 'Gdansk', Object_type: 'Painting', Decades: '2000-2010',
    Technique: 'Oil on canvas', Year: '2024',
    Price: { PLN: 1800, USD: 495, EUR: 430 }, Status: 'available'
  },
  {
    ID: 900001, Title: 'Red Fields', Artist: 'Alfred Aniol',
    Width: '100', Height: '70', Depth: '2',
    Photo: 'https://picsum.photos/seed/900001/1000/700',
    Category: 'Landscape', Collection: 'Impressionist', Location: 'Krakow',
    Object_type: 'Painting', Decades: '2010-2020', Technique: 'Oil', Year: '2023',
    Price: { PLN: 1200, USD: 330, EUR: 285 }, Status: 'available'
  },
  {
    ID: 900002, Title: 'Blue Hour', Artist: 'Maria Kowalska',
    Width: '50', Height: '50', Depth: '2',
    Photo: 'https://picsum.photos/seed/900002/800/800',
    Category: 'Abstract', Collection: 'Modern', Location: 'Warsaw',
    Object_type: 'Painting', Decades: '2010-2020', Technique: 'Mixed', Year: '2024',
    Price: { PLN: 900, USD: 247, EUR: 213 }, Status: 'available'
  },
  {
    ID: 900003, Title: 'Old Pier', Artist: 'Jan Nowak',
    Width: '140', Height: '90', Depth: '3',
    Photo: 'https://picsum.photos/seed/900003/1400/900',
    Category: 'Seascape', Collection: 'Classic', Location: 'Gdansk',
    Object_type: 'Painting', Decades: '2000-2010', Technique: 'Oil', Year: '2022',
    Price: { PLN: 2600, USD: 715, EUR: 615 }, Status: 'available'
  }
];
