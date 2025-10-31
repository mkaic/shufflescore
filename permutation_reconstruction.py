import random
import itertools
import numpy as np

print("Generating deck of cards...")
ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
suits = ["S", "H", "D", "C"]
deck_of_cards = []
for suit in suits:
    for rank in ranks:
        deck_of_cards.append(rank + suit)

deck_of_cards = deck_of_cards[:13]  # For testing

shuffled_deck_of_cards = deck_of_cards.copy()

print("Shuffling deck of cards...")
random.shuffle(shuffled_deck_of_cards)
print("Shuffled deck of cards:")
print(shuffled_deck_of_cards)

window_size = 5
card_pair_orders = {}


for i in range(len(shuffled_deck_of_cards) - window_size + 1):
    window = shuffled_deck_of_cards[i : i + window_size]
    # print(f"\n\nWindow {i}: {window}\n")
    for sample in range(100):
        for i, (card_a, card_b) in enumerate(itertools.combinations(window, 2)):
            card_a_idx = window.index(card_a)
            card_b_idx = window.index(card_b)

            distance_forward_sign = np.sign(card_b_idx - card_a_idx)
            if random.random() < 0.6:
                distance_forward_sign = -distance_forward_sign

            # in case they don't exist yet, create them
            card_pair_orders[card_a] = card_pair_orders.get(card_a, {})
            card_pair_orders[card_b] = card_pair_orders.get(card_b, {})

            card_pair_orders[card_a][card_b] = (
                card_pair_orders[card_a].get(card_b, 0) + distance_forward_sign
            )
            card_pair_orders[card_b][card_a] = (
                card_pair_orders[card_b].get(card_a, 0) - distance_forward_sign
            )
            # print(f"Pair {pair_name_forward}: {card_pair_orders[pair_name_forward]}")
            # print(f"Pair {pair_name_backward}: {card_pair_orders[pair_name_backward]}")
            # print("--------------------------------")

observed_cards = list(card_pair_orders.keys())
scores = []


def get_all_cards_on_one_side_of_card(card, card_pair_orders, sign_of_distance=1):
    stack_to_check = [card]
    checked_cards = set()
    cards_on_one_side = set()
    while len(stack_to_check) > 0:
        current_card = stack_to_check.pop()
        connected_cards = [
            c for c in card_pair_orders[current_card] if c not in checked_cards
        ]
        for connected_card in connected_cards:
            if (
                np.sign(card_pair_orders[current_card][connected_card])
                == sign_of_distance
            ):
                checked_cards.add(connected_card)
                stack_to_check.append(connected_card)
                cards_on_one_side.add(connected_card)

    return sorted(list(cards_on_one_side))


for card in observed_cards:
    ahead_score = len(get_all_cards_on_one_side_of_card(card, card_pair_orders, 1))
    behind_score = len(get_all_cards_on_one_side_of_card(card, card_pair_orders, -1))
    scores.append(behind_score - ahead_score)

permutation = np.argsort(scores)
recovered_shuffle = [observed_cards[i] for i in permutation]
print("Recovered shuffle:")
print(recovered_shuffle)

# for card in observed_cards:

# print("Shuffled deck of cards:")
# print(shuffled_deck_of_cards)
# print("Recovered shuffle:")
# print(recovered_shuffle)
