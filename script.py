from bs4 import BeautifulSoup
import json
import re

# Sample channel data extracted from the HTML you provided
# This demonstrates the structure - add all channels here
SAMPLE_CHANNELS_DATA = """
<a href='/player/CanalliveSport-1'><img src='https://i.postimg.cc/sXNGtdFp/canallive-1.webp' alt='CanalliveSport-1'/><span style="font-size: 18px; font-weight: bold;">CanalliveSport-1</span></a>
<a href='/player/Eurosport-1'><img src='https://i.postimg.cc/nLJCvxmz/euro1-nou.webp' alt='Eurosport-1'/><span style="font-size: 18px; font-weight: bold;">Eurosport-1</span></a>
<a href='/player/Sky-Sports-F1'><img src='https://i.postimg.cc/JzGwLhTD/sky-F1.webp' alt='Sky-Sports-F1'/><span style="font-size: 18px; font-weight: bold;">Sky-Sports-F1</span></a>
"""

def extract_channels_quick():
    """Quick extraction using known channel patterns"""
    
    channels = [
        {'name': 'CanalliveSport-1', 'player': '/player/CanalliveSport-1', 'logo': 'https://i.postimg.cc/sXNGtdFp/canallive-1.webp'},
        {'name': 'CanalliveSport-2', 'player': '/player/CanalliveSport-2', 'logo': 'https://i.postimg.cc/RC2XH236/canallive-2.webp'},
        {'name': 'CanalliveSport-3', 'player': '/player/CanalliveSport-3', 'logo': 'https://i.postimg.cc/rwkjhWNq/canallive-3.webp'},
        {'name': 'CanalliveSport-4', 'player': '/player/CanalliveSport-4', 'logo': 'https://i.postimg.cc/k5jyXH35/Canallive-4.webp'},
        {'name': 'Eurosport-1', 'player': '/player/Eurosport-1', 'logo': 'https://i.postimg.cc/nLJCvxmz/euro1-nou.webp'},
        {'name': 'Eurosport-2', 'player': '/player/Eurosport-2', 'logo': 'https://i.postimg.cc/MKLBfgtM/Euro-2-nou.webp'},
        {'name': 'SportTv-1', 'player': '/player/SportTv-1', 'logo': 'https://i.postimg.cc/KYsXTMbq/sport-tv-1.webp'},
        {'name': 'SportTv-2', 'player': '/player/SportTv-2', 'logo': 'https://i.postimg.cc/Wzzhnrqd/sport-tv-2.webp'},
        {'name': 'SportTv-3', 'player': '/player/SportTv-3', 'logo': 'https://i.postimg.cc/MGscjdXC/sport-tv-3.webp'},
        {'name': 'Sky-Sports-Arena', 'player': '/player/Sky-Sports-Arena', 'logo': 'https://i.postimg.cc/Y9JfyMXW/aky-arena.webp'},
        {'name': 'Sky-Sports-Main-Event', 'player': '/player/Sky-Sports-Main-Event', 'logo': 'https://i.postimg.cc/0NsCCWJk/sky-main-event.webp'},
        {'name': 'Sky-Sports-Footbal', 'player': '/player/Sky-Sports-Footbal', 'logo': 'https://i.postimg.cc/1zVZpzwh/sky-fotbal-3.webp'},
        {'name': 'Sky-Sports-F1', 'player': '/player/Sky-Sports-F1', 'logo': 'https://i.postimg.cc/JzGwLhTD/sky-F1.webp'},
        {'name': 'Sport-Klub-1', 'player': '/player/Sport-Klub-1', 'logo': 'https://i.postimg.cc/QMJk6rnz/sport-klub-1.webp'},
        {'name': 'Sport-Klub-2', 'player': '/player/Sport-Klub-2', 'logo': 'https://i.postimg.cc/D0n0y8Qv/sport-klub-2.webp'},
        {'name': 'Sport-Klub-3', 'player': '/player/Sport-Klub-3', 'logo': 'https://i.postimg.cc/fTx4f8hr/sport-klub-3.webp'},
        {'name': 'Sport-Klub-4', 'player': '/player/Sport-Klub-4', 'logo': 'https://i.postimg.cc/LsW0pPpP/sport-klub-4.webp'},
        {'name': 'Sport-Klub-5', 'player': '/player/Sport-Klub-5', 'logo': 'https://i.postimg.cc/FKSnhRsn/sport-klub-5.webp'},
        {'name': 'Sport-Klub-6', 'player': '/player/Sport-Klub-6', 'logo': 'https://i.postimg.cc/WbQb0M5W/sport-klub-6.webp'},
        {'name': 'Sport-Klub', 'player': '/player/Sport-Klub', 'logo': 'https://i.postimg.cc/3wg5v45y/sport-klub-HD.webp'},
        {'name': 'Tenis-Channel-1', 'player': '/player/Tenis-Channel-1', 'logo': 'https://i.postimg.cc/BbQS5gMX/Tenis-channel-1.webp'},
        {'name': 'Tenis-Channel-2', 'player': '/player/Tenis-Channel-2', 'logo': 'https://i.postimg.cc/7ZYBvQZK/tenis-channel-2.webp'},
        {'name': 'Tenis-Channel-3', 'player': '/player/Tenis-Channel-3', 'logo': 'https://i.postimg.cc/bwCmqHGp/tenis-channel-3.webp'},
        {'name': 'Tenis-Channel-4', 'player': '/player/Tenis-Channel-4', 'logo': 'https://i.postimg.cc/NG6bKwyN/tenis-channel-4.webp'},
        {'name': 'Tenis-Channel-5', 'player': '/player/Tenis-Channel-5', 'logo': 'https://i.postimg.cc/j5VQj8R0/tenis-channel-5.webp'},
        {'name': 'Tenis-Channel-6', 'player': '/player/Tenis-Channel-6', 'logo': 'https://i.postimg.cc/HW94p4KR/tenis-channel-6.webp'},
        {'name': 'Tenis-Channel-7', 'player': '/player/Tenis-Channel-7', 'logo': 'https://i.postimg.cc/T13y2m5v/tenis-channel-7.webp'},
        {'name': 'Impact', 'player': '/player/Impact', 'logo': 'https://i.postimg.cc/6qCBmJZb/Impact-Wrestling.webp'},
        {'name': 'Sports-TV', 'player': '/player/Sports-TV', 'logo': 'https://i.postimg.cc/nLkxWjdy/sports-tv-turkia.webp'},
        {'name': 'ZiggoSport-1', 'player': '/player/ZiggoSport-1', 'logo': 'https://i.postimg.cc/rpLPBNJt/Ziggo-sport.webp'},
        {'name': 'ZiggoSport-2', 'player': '/player/ZiggoSport-2', 'logo': 'https://i.postimg.cc/vB026FdW/ziggo-sport-2.webp'},
        {'name': 'ZiggoSport-3', 'player': '/player/ZiggoSport-3', 'logo': 'https://i.postimg.cc/Hscvjhvy/ziggo-sport-3.webp'},
        {'name': 'ZiggoSport-5', 'player': '/player/ZiggoSport-5', 'logo': 'https://i.postimg.cc/2jLn7vTt/ziggo-sport-5.webp'},
        {'name': 'SportItalia', 'player': '/player/SportItalia', 'logo': 'https://i.postimg.cc/sf0cTbGX/sport-italia.webp'},
        {'name': 'NBA-TV', 'player': '/player/NBA-TV', 'logo': 'https://i.postimg.cc/9M2LbP0D/NBA-TV.webp'},
        {'name': 'BeinSport-Xtra-n', 'player': '/player/BeinSport-Xtra-n', 'logo': 'https://i.postimg.cc/7LRb3NGF/beinsport-xtra-n.webp'},
        {'name': 'Live1', 'player': '/player/Live1', 'logo': 'https://i.postimg.cc/RZhMrkL1/live-1.webp'},
        {'name': 'PrimaSport1', 'player': '/player/PrimaSport1', 'logo': 'https://i.postimg.cc/0jfNJS2s/prima-sport-1.webp'},
        {'name': 'PrimaSport2', 'player': '/player/PrimaSport2', 'logo': 'https://i.postimg.cc/MZv9xfmC/prima-sport-2.webp'},
        {'name': 'PrimaSport3', 'player': '/player/PrimaSport3', 'logo': 'https://i.postimg.cc/7L55b4tZ/prima-sport-3.webp'},
        {'name': 'PrimaSport4', 'player': '/player/PrimaSport4', 'logo': 'https://i.postimg.cc/8CvTqznM/prima-sport-4.webp'},
        {'name': 'PrimaSport5', 'player': '/player/PrimaSport5', 'logo': 'https://i.postimg.cc/52wPTcSj/prima-sport-5.webp'},
        {'name': 'SporTv', 'player': '/player/SporTv', 'logo': 'https://i.postimg.cc/d3r3cXxr/sport-tv-brasil.webp'},
        {'name': 'FIFA+', 'player': '/player/FIFA%2B', 'logo': 'https://i.postimg.cc/QdPHvchH/Fifa.png'},
        {'name': 'RETE-8Sport', 'player': '/player/RETE-8Sport', 'logo': 'https://i.postimg.cc/N01tw31Z/rete8.png'},
        {'name': 'Live3', 'player': '/player/Live3', 'logo': 'https://i.postimg.cc/DwTR7zNx/live3.png'},
        {'name': 'Auto-Moto', 'player': '/player/Auto-Moto', 'logo': 'https://i.postimg.cc/MGXSV06W/moto-1.png'},
        {'name': 'Live4', 'player': '/player/Live4', 'logo': 'https://i.postimg.cc/3xsB0XCy/live4.webp'},
        {'name': 'Live2', 'player': '/player/Live2', 'logo': 'https://i.postimg.cc/Y9BQPjMS/live-2.webp'},
        {'name': 'RaiSport', 'player': '/player/RaiSport', 'logo': 'https://i.postimg.cc/ZRSNvbFZ/raisport.webp'},
        {'name': 'Bike', 'player': '/player/Bike', 'logo': 'https://i.postimg.cc/vZ1JCdC1/Bike.webp'},
        {'name': 'RealMadrid-TV', 'player': '/player/RealMadrid-TV', 'logo': 'https://i.postimg.cc/Gh3Y5vqB/real-madrid.webp'},
        {'name': 'Sportivo-italiano', 'player': '/player/Sportivo-italiano', 'logo': 'https://iili.io/Kx7bkR2.webp'},
        {'name': 'ArenaTenis', 'player': '/player/ArenaTenis', 'logo': 'https://i.postimg.cc/y8836M8m/Arena-Tenis.webp'},
        {'name': 'FIFA+2', 'player': '/player/FIFA%2B2', 'logo': 'https://i.postimg.cc/VLrvwTyq/Fifa.webp'},
    ]
    
    base_url = "https://fast-tv.net"
    formatted_channels = []
    
    for ch in channels:
        formatted_channels.append({
            'name': ch['name'],
            'player_url': f"{base_url}{ch['player']}",
            'logo': ch['logo'],
            'embed_url': None,  # Will need to fetch from player page
            'headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': base_url,
                'Origin': base_url
            }
        })
    
    return formatted_channels

def save_channels(channels, filename='sports_channels.json'):
    """Save to JSON"""
    output = {
        'source': 'fast-tv.net',
        'category': 'Sport',
        'total_channels': len(channels),
        'extraction_date': '2024-12-06',
        'note': 'Player URLs contain the video players. Embed URLs need to be extracted from each player page.',
        'playback_requirements': {
            'headers_required': True,
            'referer': 'https://fast-tv.net/',
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        'channels': channels
    }
    
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ Saved {len(channels)} channels to {filename}")

def main():
    print("="*60)
    print("Fast-TV Sports Channels - Instant Extraction")
    print("="*60)
    
    channels = extract_channels_quick()
    
    print(f"\n✓ Extracted {len(channels)} channels")
    print("\nSample channels:")
    for ch in channels[:5]:
        print(f"  • {ch['name']}")
        print(f"    {ch['player_url']}")
    
    save_channels(channels)
    
    print("\n" + "="*60)
    print("SUCCESS! Check sports_channels.json")
    print("="*60)
    print("\nTo get actual stream URLs, you need to:")
    print("1. Visit each player_url in a browser")
    print("2. Inspect the video player iframe source")
    print("3. Or use Selenium to automate extraction")

if __name__ == "__main__":
    main()