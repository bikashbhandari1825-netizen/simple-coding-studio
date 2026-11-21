// 📦 "पूरा starter" — नयाँ Flutter एपमै सबै फोल्डर र फाइल तयार (screens, models, services, widgets, theme, routes)।
// "Complete starter": every folder and file a normal app needs is created automatically, so nothing has to be made by hand.
// नयाँ स्क्रिन थप्न: फाइल बनाउने र lib/routes.dart मा एउटा लाइन — to add a screen: create the file and add one line to lib/routes.dart.
// Dart कोडमा backtick र dollar-brace प्रयोग नगर्ने (TypeScript template literal) — no backticks or dollar-brace inside the Dart text.

const GUIDE = `# नयाँ स्क्रिन कसरी थप्ने · How to add a new screen

1. English: Make a file in lib/screens/, for example lib/screens/profile_screen.dart.
   नेपाली: lib/screens/ मा नयाँ फाइल बनाउनुहोस्, जस्तै lib/screens/profile_screen.dart।
2. English: Open lib/routes.dart, add the name in AppRoutes and one line in the routes map.
   नेपाली: lib/routes.dart खोलेर AppRoutes मा नाम र routes मा एउटा लाइन थप्नुहोस्।
3. English: Go there with Navigator.pushNamed(context, AppRoutes.profile).
   नेपाली: त्यहाँ जान Navigator.pushNamed(context, AppRoutes.profile) प्रयोग गर्नुहोस्।

Folders · फोल्डरहरू
- lib/screens   : every screen · सबै स्क्रिन
- lib/models    : data shapes · डाटाको बनावट
- lib/services  : saving and loading · सेभ र लोड
- lib/widgets   : small reusable parts · दोहोरिने सानो भाग
- lib/theme     : colours and style · रङ र शैली
- lib/config    : fixed values · स्थिर मान
`;

export function completeFiles(appName: string): Record<string, string> {
  const title = appName.replace(/['\\$]/g, ' ').trim() || 'My App';
  return {
    'lib/main.dart': `import 'package:flutter/material.dart';

import 'app.dart';
import 'services/storage_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Load the saved items before the first screen.
  await StorageService.instance.load();
  runApp(const App());
}
`,
    'lib/app.dart': `import 'package:flutter/material.dart';

import 'config/constants.dart';
import 'routes.dart';
import 'theme/app_theme.dart';

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: kAppName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      initialRoute: AppRoutes.home,
      routes: appRoutes,
    );
  }
}
`,
    'lib/routes.dart': `import 'package:flutter/widgets.dart';

import 'screens/add_item_screen.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';

/// Every screen name. To add a screen: add a name here and a line below.
class AppRoutes {
  static const home = '/';
  static const addItem = '/add';
  static const settings = '/settings';
}

final Map<String, WidgetBuilder> appRoutes = {
  AppRoutes.home: (_) => const HomeScreen(),
  AppRoutes.addItem: (_) => const AddItemScreen(),
  AppRoutes.settings: (_) => const SettingsScreen(),
};
`,
    'lib/config/constants.dart': `/// Fixed values used in many places.
const String kAppName = '${title}';
`,
    'lib/theme/app_theme.dart': `import 'package:flutter/material.dart';

class AppTheme {
  static ThemeData get light => ThemeData(
        colorSchemeSeed: Colors.indigo,
        useMaterial3: true,
      );
}
`,
    'lib/models/item.dart': `/// One saved thing. Rename or add fields for your own app.
class Item {
  const Item({
    required this.id,
    required this.title,
    this.note = '',
    required this.createdAt,
  });

  final String id;
  final String title;
  final String note;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'note': note,
        'createdAt': createdAt.toIso8601String(),
      };

  factory Item.fromJson(Map<String, dynamic> json) {
    return Item(
      id: json['id'] as String,
      title: json['title'] as String,
      note: (json['note'] as String?) ?? '',
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
}
`,
    'lib/services/storage_service.dart': `import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/item.dart';

/// Keeps the items and saves them on the device, so they are still here
/// after the app is closed and opened again.
class StorageService extends ChangeNotifier {
  StorageService._();

  static final StorageService instance = StorageService._();

  static const _key = 'items_v1';

  final List<Item> _items = [];

  List<Item> get items => List.unmodifiable(_items);

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final text = prefs.getString(_key);
    _items.clear();
    if (text != null && text.isNotEmpty) {
      try {
        final list = jsonDecode(text) as List<dynamic>;
        _items.addAll(
          list.map((e) => Item.fromJson(e as Map<String, dynamic>)),
        );
      } catch (_) {
        // Broken saved data is ignored.
      }
    }
    notifyListeners();
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _key,
      jsonEncode(_items.map((e) => e.toJson()).toList()),
    );
  }

  Future<void> add(String title, String note) async {
    _items.insert(
      0,
      Item(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        title: title,
        note: note,
        createdAt: DateTime.now(),
      ),
    );
    notifyListeners();
    await _save();
  }

  Future<void> remove(String id) async {
    _items.removeWhere((e) => e.id == id);
    notifyListeners();
    await _save();
  }

  Future<void> clear() async {
    _items.clear();
    notifyListeners();
    await _save();
  }
}
`,
    'lib/widgets/empty_state.dart': `import 'package:flutter/material.dart';

/// A friendly message for an empty list.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(message, textAlign: TextAlign.center),
      ),
    );
  }
}
`,
    'lib/screens/home_screen.dart': `import 'package:flutter/material.dart';

import '../config/constants.dart';
import '../routes.dart';
import '../services/storage_service.dart';
import '../widgets/empty_state.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = StorageService.instance;
    return Scaffold(
      appBar: AppBar(
        title: const Text(kAppName),
        actions: [
          IconButton(
            tooltip: 'Settings',
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.pushNamed(context, AppRoutes.settings),
          ),
        ],
      ),
      body: ListenableBuilder(
        listenable: store,
        builder: (context, _) {
          final items = store.items;
          if (items.isEmpty) {
            return const EmptyState(
              message: 'Nothing here yet. Tap + to add the first one.\\nयहाँ केही छैन। + थिचेर पहिलो थप्नुहोस्।',
            );
          }
          return ListView(
            padding: const EdgeInsets.all(12),
            children: [
              for (final item in items)
                Card(
                  child: ListTile(
                    title: Text(item.title),
                    subtitle: item.note.isEmpty ? null : Text(item.note),
                    trailing: IconButton(
                      tooltip: 'Delete',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () => store.remove(item.id),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => Navigator.pushNamed(context, AppRoutes.addItem),
        child: const Icon(Icons.add),
      ),
    );
  }
}
`,
    'lib/screens/add_item_screen.dart': `import 'package:flutter/material.dart';

import '../services/storage_service.dart';

class AddItemScreen extends StatefulWidget {
  const AddItemScreen({super.key});

  @override
  State<AddItemScreen> createState() => _AddItemScreenState();
}

class _AddItemScreenState extends State<AddItemScreen> {
  final _title = TextEditingController();
  final _note = TextEditingController();

  @override
  void dispose() {
    _title.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final title = _title.text.trim();
    if (title.isEmpty) return;
    await StorageService.instance.add(title, _note.text.trim());
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _title,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Title'),
          ),
          TextField(
            controller: _note,
            decoration: const InputDecoration(labelText: 'Note'),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _save,
            icon: const Icon(Icons.save),
            label: const Text('Save'),
          ),
        ],
      ),
    );
  }
}
`,
    'lib/screens/settings_screen.dart': `import 'package:flutter/material.dart';

import '../config/constants.dart';
import '../services/storage_service.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          const ListTile(
            leading: Icon(Icons.info_outline),
            title: Text(kAppName),
            subtitle: Text('Version 1.0.0'),
          ),
          ListTile(
            leading: const Icon(Icons.delete_sweep),
            title: const Text('Delete all saved items'),
            onTap: () async {
              await StorageService.instance.clear();
              if (context.mounted) Navigator.pop(context);
            },
          ),
        ],
      ),
    );
  }
}
`,
    'ADD_A_SCREEN.md': GUIDE,
  };
}
