from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'worker' / 'rubric-v2.test.mjs'
text = path.read_text(encoding='utf-8')
old = r'''  }), answer, {
    question: 'Does bad intent alone create criminal liability?',
    suggestedAnswer: 'No. Criminal liability requires the elements of the offense or another statutory basis; intent alone is insufficient.',
    legalBasis: 'Revised Penal Code.',
    verified: true,
  });
'''
new = r'''  }), answer, {
    question: 'Explain whether bad intent alone creates criminal liability.',
    questionType: 'explanation',
    applicationRequired: false,
    suggestedAnswer: 'No. Criminal liability requires the elements of the offense or another statutory basis; intent alone is insufficient.',
    legalBasis: 'Revised Penal Code.',
    verified: true,
  });
'''
if text.count(old) != 1:
    raise RuntimeError(f'negative-control anchor count: {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Corrected intent-only negative-control question type.')
