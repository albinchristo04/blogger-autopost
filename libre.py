import requests
import json
from datetime import datetime
from typing import List, Dict, Any
import base64

class RojadirectaScraper:
    """Scraper for RojadirectaTV sports events"""
    
    def __init__(self):
        self.agenda_url = "https://a.ftvhd.com/diaries.json"
        self.img_base = "https://img.futbolonlinehd.com"
        self.site_base = "https://rojadirectahd.futbol"
        
    def fetch_events(self) -> Dict[str, Any]:
        """Fetch events from the API"""
        try:
            response = requests.get(self.agenda_url, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching events: {e}")
            return {}
    
    def decode_event_url(self, encoded_url: str) -> str:
        """Decode base64 encoded URL from eventos.html?r="""
        try:
            # Extract the base64 part after ?r=
            if '?r=' in encoded_url:
                encoded_part = encoded_url.split('?r=')[1]
                decoded = base64.b64decode(encoded_part).decode('utf-8')
                return decoded
            return encoded_url
        except Exception as e:
            print(f"Error decoding URL: {e}")
            return encoded_url
    
    def extract_event_data(self, raw_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract and structure event data"""
        if not raw_data or 'data' not in raw_data:
            return []
        
        events = []
        
        for item in raw_data.get('data', []):
            attributes = item.get('attributes', {})
            
            # Extract country flag
            country_data = attributes.get('country', {}).get('data', {})
            country_attrs = country_data.get('attributes', {})
            flag_data = country_attrs.get('image', {}).get('data', {})
            flag_url = flag_data.get('attributes', {}).get('url', '')
            
            if flag_url:
                flag_url = f"{self.img_base}{flag_url}"
            else:
                flag_url = f"{self.img_base}/uploads/sin_imagen_d36205f0e8.png"
            
            # Extract channels/embeds
            embeds_data = attributes.get('embeds', {}).get('data', [])
            channels = []
            
            for embed in embeds_data:
                embed_attrs = embed.get('attributes', {})
                embed_url = embed_attrs.get('embed_iframe', '').strip()
                
                # Handle relative URLs
                if embed_url.startswith('/'):
                    embed_url = f"{self.site_base}{embed_url}"
                elif not embed_url:
                    embed_url = f"{self.site_base}/embed/eventos.html?r="
                
                # Try to decode if it's an eventos.html URL
                decoded_url = self.decode_event_url(embed_url)
                
                channel = {
                    'name': embed_attrs.get('embed_name', 'Ver enlace'),
                    'url': embed_url,
                    'decoded_url': decoded_url if decoded_url != embed_url else None
                }
                channels.append(channel)
            
            # Structure the event
            event = {
                'id': item.get('id'),
                'time': attributes.get('diary_hour', '--:--'),
                'date': attributes.get('date_diary', ''),
                'description': attributes.get('diary_description', 'Evento sin título'),
                'country': country_attrs.get('name', 'Unknown'),
                'flag_url': flag_url,
                'channels': channels,
                'channel_count': len(channels)
            }
            
            events.append(event)
        
        # Sort by date and time
        events.sort(key=lambda x: f"{x['date']} {x['time']}")
        
        return events
    
    def save_to_json(self, events: List[Dict[str, Any]], filename: str = 'rojadirecta_events.json'):
        """Save events to JSON file"""
        output = {
            'scraped_at': datetime.now().isoformat(),
            'total_events': len(events),
            'events': events
        }
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        
        print(f"✅ Saved {len(events)} events to {filename}")
    
    def run(self, output_file: str = 'rojadirecta_events.json'):
        """Main execution method"""
        print("🔄 Fetching events from RojadirectaTV...")
        raw_data = self.fetch_events()
        
        if not raw_data:
            print("❌ No data retrieved")
            return
        
        print("📊 Processing events...")
        events = self.extract_event_data(raw_data)
        
        print(f"📋 Found {len(events)} events")
        
        # Display summary
        for event in events[:5]:  # Show first 5 events
            print(f"\n⚽ {event['description']}")
            print(f"   📅 {event['date']} {event['time']}")
            print(f"   🏴 {event['country']}")
            print(f"   📺 {event['channel_count']} channels available")
        
        if len(events) > 5:
            print(f"\n... and {len(events) - 5} more events")
        
        # Save to file
        self.save_to_json(events, output_file)
        
        return events


if __name__ == "__main__":
    scraper = RojadirectaScraper()
    events = scraper.run()
    
    # Optional: Display channel details for first event
    if events and events[0]['channels']:
        print("\n" + "="*60)
        print(f"📺 Channel details for: {events[0]['description']}")
        print("="*60)
        for i, channel in enumerate(events[0]['channels'], 1):
            print(f"\nChannel {i}: {channel['name']}")
            print(f"URL: {channel['url']}")
            if channel['decoded_url']:
                print(f"Decoded: {channel['decoded_url']}")