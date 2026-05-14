import requests
import json

def test_nola_order():
    url = "https://meupainel.expressoneves.com/api/nola/abrir-solicitacao"
    
    # Adicionamos novamente o Token de Autorização, 
    # pois as validações foram restauradas no sistema.
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer nola_sec_99a8b7c6d5e4f3g2h1"
    }

    # Corpo da requisição seguindo a documentação da Machine API
    # O Gateway (Painel) agora aceita tanto este formato quanto o formato interno.
    payload = {
        "empresa_id": "108318",
        "forma_pagamento": "F",
        "observacao": "1x Combo Smash Kafta Kebab. (Aioli, Alho da Casa, Quero Todos!, Quero a Batata Frita!, Mate da Casa 300 Ml)",
        "partida": {
            "endereco": "Rua Dias Ferreira, 147 - Leblon, Rio de Janeiro - RJ",
            "lat": "-22.9846",
            "lng": "-43.2193"
        },
        "paradas": [
            {
                "endereco_parada": "Rua Visconde de Pirajá, 351 - Ipanema, Rio de Janeiro - RJ, sala 815 , Rio de Janeiro",
                "lat_parada": "-22.98463517",
                "lng_parada": "-43.20561715",
                "nome_cliente_parada": "Raquel Umbelina",
                "telefone_cliente_parada": "5511971520451",
                "observacao_parada": "Pedido 99Food #429006 | R$48.32"
            }
        ]
    }

    print(f"Enviando pedido para: {url}...")
    
    try:
        response = requests.post(url, headers=headers, data=json.dumps(payload))
        
        print(f"\n=== RESULTADO ===")
        print(f"Status Code: {response.status_code}")
        
        try:
            result = response.json()
            print("Resposta JSON:")
            print(json.dumps(result, indent=2, ensure_ascii=False))
        except:
            print("Resposta (não-JSON):")
            print(response.text)
            
    except Exception as e:
        print(f"Erro ao conectar: {e}")

if __name__ == "__main__":
    test_nola_order()
