import fs from 'node:fs/promises';
import path from 'node:path';
import type { FlutterTemplateId } from '../shared/types';
import { completeFiles } from './flutterTemplateComplete';

// ✨ नयाँ Flutter एपका तयार starter template — ready-made starters applied on top of `flutter create`.
// "basic" ले `flutter create` को Counter एप जस्ताको तस्तै राख्छ; बाँकीले lib/ बदल्छन् र packages थप्छन्।
// "basic" keeps the stock Counter app; the others replace lib/ and add packages.
// Firebase config (flutterfire configure) बिना पनि एप क्र्यास हुँदैन — सेटअप स्क्रिन देखाउँछ।
// Without Firebase config the app does not crash; it shows a setup screen.

export interface TemplateSpec {
  /** `flutter pub add` गर्ने packages — packages to add */
  packages: string[];
  /** project root सापेक्ष फाइल → सामग्री — files relative to the project root */
  files: Record<string, string>;
  /** मेट्नुपर्ने फाइल (पुरानो test जस्ता) — files to delete */
  remove: string[];
}

const SETUP_README = `# Firebase सेटअप · Firebase setup

यो starter ले Firebase प्रयोग गर्छ। एक पटक यो गर्नुहोस् · Do this once:

1. https://console.firebase.google.com मा project बनाउनुहोस् · Create a project.
2. Authentication → Sign-in method → Email/Password (Map starter मा Anonymous) खोल्नुहोस् · Enable it.
3. Firestore Database बनाउनुहोस् (test mode बाट सुरु) · Create a Firestore database (start in test mode).
4. Terminal मा · In a terminal:
   \`\`\`
   dart pub global activate flutterfire_cli
   flutterfire configure
   \`\`\`
5. \`lib/main.dart\` को माथि \`import 'firebase_options.dart';\` राख्नुहोस् र
   \`Firebase.initializeApp()\` लाई \`Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform)\` बनाउनुहोस्।

Android: \`android/app/build.gradle*\` मा minSdk २३ वा बढी हुनुपर्छ · minSdk must be 23 or higher.

⚠️ Production अघि Firestore rules कडा बनाउनुहोस् · Tighten Firestore security rules before going live.
`;

// ---------------------------------------------------------------- Firebase Auth + Firestore
const firebaseMain = `import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'auth_gate.dart';
import 'setup_help_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  Object? initError;
  try {
    await Firebase.initializeApp().timeout(const Duration(seconds: 15));
  } catch (error) {
    initError = error;
  }
  runApp(StarterApp(initError: initError));
}

class StarterApp extends StatelessWidget {
  const StarterApp({super.key, this.initError});

  final Object? initError;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Firebase Starter',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: Colors.indigo,
        useMaterial3: true,
      ),
      home: initError == null
          ? const AuthGate()
          : SetupHelpPage(error: initError.toString()),
    );
  }
}
`;

const setupHelpPage = `import 'package:flutter/material.dart';

/// Firebase सेटअप नभएको बेला देखिने स्क्रिन · Shown while Firebase is not configured yet.
class SetupHelpPage extends StatelessWidget {
  const SetupHelpPage({super.key, required this.error});

  final String error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Firebase सेटअप चाहिन्छ · Setup needed')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Firebase अझै जोडिएको छैन।\\nFirebase is not configured yet.',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          const Text(
            'फाइल FIREBASE_SETUP.md खोलेर steps पूरा गर्नुहोस्।\\n'
            'Open FIREBASE_SETUP.md and follow the steps (flutterfire configure).',
          ),
          const SizedBox(height: 16),
          SelectableText(
            error,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
          ),
        ],
      ),
    );
  }
}
`;

const authGate = `import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'login_page.dart';
import 'notes_page.dart';

/// Login भए Notes, नभए Login पेज · Notes when signed in, otherwise the login page.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        final user = snapshot.data;
        return user == null ? const LoginPage() : NotesPage(user: user);
      },
    );
  }
}
`;

const loginPage = `import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit({required bool register}) async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = FirebaseAuth.instance;
      final email = _email.text.trim();
      final password = _password.text;
      if (register) {
        await auth.createUserWithEmailAndPassword(email: email, password: password);
      } else {
        await auth.signInWithEmailAndPassword(email: email, password: password);
      }
    } on FirebaseAuthException catch (e) {
      if (mounted) setState(() => _error = e.message ?? e.code);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Login · लगइन')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Form(
            key: _formKey,
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.all(20),
              children: [
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  decoration: const InputDecoration(labelText: 'Email'),
                  validator: (v) => (v == null || !v.contains('@')) ? 'Valid email चाहिन्छ' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _password,
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                  decoration: const InputDecoration(labelText: 'Password'),
                  validator: (v) => (v == null || v.length < 6) ? 'कम्तीमा ६ अक्षर · min 6 chars' : null,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : () => _submit(register: false),
                  child: _busy
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Sign in · लगइन'),
                ),
                TextButton(
                  onPressed: _busy ? null : () => _submit(register: true),
                  child: const Text('नयाँ खाता · Create account'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
`;

const notesPage = `import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

/// हरेक user को आफ्नै notes: users/{uid}/notes · Each user's own notes.
class NotesPage extends StatelessWidget {
  const NotesPage({super.key, required this.user});

  final User user;

  CollectionReference<Map<String, dynamic>> get _notes =>
      FirebaseFirestore.instance.collection('users').doc(user.uid).collection('notes');

  Future<void> _add(BuildContext context) async {
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('नयाँ नोट · New note'),
        content: TextField(controller: controller, autofocus: true, maxLines: 3),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('रद्द · Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('सेभ · Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (text == null || text.isEmpty) return;
    try {
      await _notes.add({'text': text, 'createdAt': FieldValue.serverTimestamp()});
    } on FirebaseException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message ?? e.code)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(user.email ?? 'Notes'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => FirebaseAuth.instance.signOut(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _add(context),
        child: const Icon(Icons.add),
      ),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: _notes.orderBy('createdAt', descending: true).snapshots(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(child: Text('Error: \${snapshot.error}'));
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final docs = snapshot.data!.docs;
          if (docs.isEmpty) {
            return const Center(child: Text('अझै नोट छैन — + थिच्नुहोस् · No notes yet — tap +'));
          }
          return ListView.separated(
            itemCount: docs.length,
            separatorBuilder: (context, index) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final doc = docs[index];
              return ListTile(
                title: Text((doc.data()['text'] as String?) ?? ''),
                trailing: IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => doc.reference.delete(),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
`;

// ---------------------------------------------------------------- Real-time Map + Counter-offer
const mapMain = (
  name: string,
) => `import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'driver_page.dart';
import 'passenger_page.dart';
import 'setup_help_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  Object? initError;
  try {
    await Firebase.initializeApp().timeout(const Duration(seconds: 15));
    if (FirebaseAuth.instance.currentUser == null) {
      await FirebaseAuth.instance.signInAnonymously();
    }
  } catch (error) {
    initError = error;
  }
  runApp(OfferApp(initError: initError));
}

class OfferApp extends StatelessWidget {
  const OfferApp({super.key, this.initError});

  final Object? initError;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${name.replace(/_/g, ' ')}',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
      home: initError == null
          ? const RoleChooser()
          : SetupHelpPage(error: initError.toString()),
    );
  }
}

class RoleChooser extends StatelessWidget {
  const RoleChooser({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('तपाईं को हुनुहुन्छ? · Who are you?')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            FilledButton.icon(
              icon: const Icon(Icons.person_pin_circle),
              label: const Text('यात्रु · Passenger'),
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => const PassengerPage()),
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              icon: const Icon(Icons.local_taxi),
              label: const Text('चालक · Driver'),
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => const DriverPage()),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
`;

const mapModels = `import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:latlong2/latlong.dart';

enum RequestStatus { open, accepted, cancelled }

class RideRequest {
  const RideRequest({
    required this.id,
    required this.passengerId,
    required this.pickup,
    required this.drop,
    required this.offerPrice,
    required this.status,
    this.acceptedOfferId,
  });

  final String id;
  final String passengerId;
  final LatLng pickup;
  final LatLng drop;
  final num offerPrice;
  final RequestStatus status;
  final String? acceptedOfferId;

  factory RideRequest.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    LatLng point(String key) {
      final g = d[key] as GeoPoint;
      return LatLng(g.latitude, g.longitude);
    }

    return RideRequest(
      id: doc.id,
      passengerId: d['passengerId'] as String? ?? '',
      pickup: point('pickup'),
      drop: point('drop'),
      offerPrice: d['offerPrice'] as num? ?? 0,
      status: RequestStatus.values.firstWhere(
        (s) => s.name == d['status'],
        orElse: () => RequestStatus.open,
      ),
      acceptedOfferId: d['acceptedOfferId'] as String?,
    );
  }
}

class CounterOffer {
  const CounterOffer({
    required this.id,
    required this.driverId,
    required this.price,
  });

  final String id;
  final String driverId;
  final num price;

  factory CounterOffer.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    return CounterOffer(
      id: doc.id,
      driverId: d['driverId'] as String? ?? '',
      price: d['price'] as num? ?? 0,
    );
  }
}
`;

const rideService = `import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:latlong2/latlong.dart';

import 'models.dart';

/// Firestore को real-time सेवा · Real-time Firestore service.
/// rideRequests/{id} र त्यसको उप-collection offers/{offerId}.
class RideService {
  RideService({FirebaseFirestore? firestore})
      : _db = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  String get uid => FirebaseAuth.instance.currentUser!.uid;

  CollectionReference<Map<String, dynamic>> get _requests => _db.collection('rideRequests');

  Future<String> createRequest({
    required LatLng pickup,
    required LatLng drop,
    required num offerPrice,
  }) async {
    final doc = await _requests.add({
      'passengerId': uid,
      'pickup': GeoPoint(pickup.latitude, pickup.longitude),
      'drop': GeoPoint(drop.latitude, drop.longitude),
      'offerPrice': offerPrice,
      'status': RequestStatus.open.name,
      'createdAt': FieldValue.serverTimestamp(),
    });
    return doc.id;
  }

  Stream<RideRequest> watchRequest(String id) =>
      _requests.doc(id).snapshots().map(RideRequest.fromDoc);

  Stream<List<RideRequest>> watchOpenRequests() => _requests
      .where('status', isEqualTo: RequestStatus.open.name)
      .snapshots()
      .map((s) => s.docs.map(RideRequest.fromDoc).toList());

  Stream<List<CounterOffer>> watchOffers(String requestId) => _requests
      .doc(requestId)
      .collection('offers')
      .orderBy('price')
      .snapshots()
      .map((s) => s.docs.map(CounterOffer.fromDoc).toList());

  /// चालकले आफ्नो मूल्य दिन्छ (counter-offer) · A driver sends a counter-offer.
  Future<void> sendCounterOffer(String requestId, num price) =>
      _requests.doc(requestId).collection('offers').doc(uid).set({
        'driverId': uid,
        'price': price,
        'createdAt': FieldValue.serverTimestamp(),
      });

  /// यात्रुले एउटा offer स्वीकार्छ · The passenger accepts one offer.
  Future<void> acceptOffer(String requestId, CounterOffer offer) =>
      _requests.doc(requestId).update({
        'status': RequestStatus.accepted.name,
        'acceptedOfferId': offer.id,
        'offerPrice': offer.price,
      });

  Future<void> cancelRequest(String requestId) =>
      _requests.doc(requestId).update({'status': RequestStatus.cancelled.name});
}
`;

const mapWidget = (name: string) => `import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

/// OpenStreetMap नक्सा (API key चाहिँदैन) · OpenStreetMap view, no API key needed.
class RideMap extends StatelessWidget {
  const RideMap({
    super.key,
    required this.center,
    this.pickup,
    this.drop,
    this.onTap,
  });

  final LatLng center;
  final LatLng? pickup;
  final LatLng? drop;
  final void Function(LatLng point)? onTap;

  @override
  Widget build(BuildContext context) {
    return FlutterMap(
      options: MapOptions(
        initialCenter: center,
        initialZoom: 13,
        onTap: onTap == null ? null : (_, point) => onTap!(point),
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.example.${name}',
        ),
        MarkerLayer(
          markers: [
            if (pickup != null)
              Marker(
                point: pickup!,
                width: 40,
                height: 40,
                child: const Icon(Icons.location_on, color: Colors.green, size: 40),
              ),
            if (drop != null)
              Marker(
                point: drop!,
                width: 40,
                height: 40,
                child: const Icon(Icons.flag, color: Colors.red, size: 36),
              ),
          ],
        ),
      ],
    );
  }
}
`;

const passengerPage = `import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import 'models.dart';
import 'ride_map.dart';
import 'ride_service.dart';

const _kathmandu = LatLng(27.7172, 85.3240);

class PassengerPage extends StatefulWidget {
  const PassengerPage({super.key});

  @override
  State<PassengerPage> createState() => _PassengerPageState();
}

class _PassengerPageState extends State<PassengerPage> {
  final _service = RideService();
  final _price = TextEditingController(text: '300');
  LatLng? _pickup;
  LatLng? _drop;
  String? _requestId;
  bool _busy = false;

  @override
  void dispose() {
    _price.dispose();
    super.dispose();
  }

  void _onMapTap(LatLng point) {
    setState(() {
      if (_pickup == null) {
        _pickup = point;
      } else {
        _drop = point;
      }
    });
  }

  Future<void> _submit() async {
    final price = num.tryParse(_price.text.trim());
    if (_pickup == null || _drop == null || price == null || price <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('नक्सामा Pickup र Drop छान्नुहोस्, मूल्य हाल्नुहोस् · Pick both points and a price')),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final id = await _service.createRequest(pickup: _pickup!, drop: _drop!, offerPrice: price);
      if (mounted) setState(() => _requestId = id);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final id = _requestId;
    return Scaffold(
      appBar: AppBar(title: const Text('यात्रु · Passenger')),
      body: id == null ? _buildForm() : _buildLive(id),
    );
  }

  Widget _buildForm() {
    return Column(
      children: [
        Expanded(
          child: RideMap(center: _kathmandu, pickup: _pickup, drop: _drop, onTap: _onMapTap),
        ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              Text(
                _pickup == null
                    ? '१) नक्सामा Pickup थिच्नुहोस् · Tap Pickup'
                    : _drop == null
                        ? '२) Drop थिच्नुहोस् · Tap Drop'
                        : 'तयार · Ready (फेरि थिचे Drop बदलिन्छ)',
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _price,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'तपाईंको मूल्य · Your offer (Rs)'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  TextButton(
                    onPressed: () => setState(() {
                      _pickup = null;
                      _drop = null;
                    }),
                    child: const Text('Reset'),
                  ),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: const Text('पठाऊ · Send'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildLive(String id) {
    return StreamBuilder<RideRequest>(
      stream: _service.watchRequest(id),
      builder: (context, snapshot) {
        final request = snapshot.data;
        if (request == null) return const Center(child: CircularProgressIndicator());
        return Column(
          children: [
            SizedBox(
              height: 220,
              child: RideMap(center: request.pickup, pickup: request.pickup, drop: request.drop),
            ),
            ListTile(
              title: Text('तपाईंको offer · Your offer: Rs \${request.offerPrice}'),
              subtitle: Text('Status: \${request.status.name}'),
              trailing: request.status == RequestStatus.open
                  ? TextButton(
                      onPressed: () async {
                        await _service.cancelRequest(id);
                        if (mounted) setState(() => _requestId = null);
                      },
                      child: const Text('रद्द · Cancel'),
                    )
                  : null,
            ),
            const Divider(height: 1),
            Expanded(
              child: request.status == RequestStatus.accepted
                  ? const Center(child: Text('✅ स्वीकार भयो · Accepted'))
                  : StreamBuilder<List<CounterOffer>>(
                      stream: _service.watchOffers(id),
                      builder: (context, offers) {
                        final list = offers.data ?? const <CounterOffer>[];
                        if (list.isEmpty) {
                          return const Center(child: Text('चालकको offer कुर्दै… · Waiting for drivers…'));
                        }
                        return ListView(
                          children: [
                            for (final offer in list)
                              ListTile(
                                leading: const Icon(Icons.local_taxi),
                                title: Text('Rs \${offer.price}'),
                                subtitle: const Text('Counter-offer'),
                                trailing: FilledButton(
                                  onPressed: () => _service.acceptOffer(id, offer),
                                  child: const Text('Accept'),
                                ),
                              ),
                          ],
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }
}
`;

const driverPage = `import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import 'models.dart';
import 'ride_map.dart';
import 'ride_service.dart';

class DriverPage extends StatefulWidget {
  const DriverPage({super.key});

  @override
  State<DriverPage> createState() => _DriverPageState();
}

class _DriverPageState extends State<DriverPage> {
  final _service = RideService();
  RideRequest? _selected;

  Future<void> _counter(RideRequest request) async {
    final controller = TextEditingController(text: request.offerPrice.toString());
    final price = await showDialog<num>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('तपाईंको मूल्य · Your counter-offer'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: const InputDecoration(prefixText: 'Rs '),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('रद्द · Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, num.tryParse(controller.text.trim())),
            child: const Text('पठाऊ · Send'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (price == null || price <= 0) return;
    try {
      await _service.sendCounterOffer(request.id, price);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Offer पठाइयो · Offer sent')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    return Scaffold(
      appBar: AppBar(title: const Text('चालक · Driver')),
      body: Column(
        children: [
          SizedBox(
            height: 240,
            child: RideMap(
              center: selected?.pickup ?? const LatLng(27.7172, 85.3240),
              pickup: selected?.pickup,
              drop: selected?.drop,
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: StreamBuilder<List<RideRequest>>(
              stream: _service.watchOpenRequests(),
              builder: (context, snapshot) {
                if (snapshot.hasError) return Center(child: Text('Error: \${snapshot.error}'));
                final list = snapshot.data;
                if (list == null) return const Center(child: CircularProgressIndicator());
                if (list.isEmpty) return const Center(child: Text('अहिले request छैन · No open requests'));
                return ListView(
                  children: [
                    for (final request in list)
                      ListTile(
                        selected: request.id == selected?.id,
                        leading: const Icon(Icons.person_pin_circle),
                        title: Text('यात्रुको offer: Rs \${request.offerPrice}'),
                        subtitle: const Text('नक्सामा हेर्न थिच्नुहोस् · Tap to view on map'),
                        onTap: () => setState(() => _selected = request),
                        trailing: FilledButton(
                          onPressed: () => _counter(request),
                          child: const Text('Counter'),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
`;

// हरेक starter मा home_screen, models, services, widgets, theme, routes जस्ता फोल्डर/फाइल पनि तयार हुन्छन्
// Every starter also gets the standard folders and files (home_screen, models, services, widgets, theme, routes).
const STRUCTURE_PACKAGES = ['shared_preferences', 'intl'];
function structureFiles(name: string): Record<string, string> {
  // main.dart हरेक starter को आफ्नै हुन्छ — each starter keeps its own main.dart
  const { 'lib/main.dart': _main, ...rest } = completeFiles(name);
  void _main;
  return rest;
}

export function templateSpec(
  id: FlutterTemplateId,
  name: string,
): TemplateSpec | null {
  if (id === 'complete')
    return {
      packages: ['shared_preferences', 'intl'],
      remove: ['test/widget_test.dart'],
      files: completeFiles(name),
    };
  if (id === 'firebase')
    return {
      packages: [
        'firebase_core',
        'firebase_auth',
        'cloud_firestore',
        ...STRUCTURE_PACKAGES,
      ],
      remove: ['test/widget_test.dart'],
      files: {
        ...structureFiles(name),
        'lib/main.dart': firebaseMain,
        'lib/auth_gate.dart': authGate,
        'lib/login_page.dart': loginPage,
        'lib/notes_page.dart': notesPage,
        'lib/setup_help_page.dart': setupHelpPage,
        'FIREBASE_SETUP.md': SETUP_README,
      },
    };
  if (id === 'map')
    return {
      packages: [
        'firebase_core',
        'firebase_auth',
        'cloud_firestore',
        'flutter_map',
        'latlong2',
        ...STRUCTURE_PACKAGES,
      ],
      remove: ['test/widget_test.dart'],
      files: {
        ...structureFiles(name),
        'lib/main.dart': mapMain(name),
        'lib/models.dart': mapModels,
        'lib/ride_service.dart': rideService,
        'lib/ride_map.dart': mapWidget(name),
        'lib/passenger_page.dart': passengerPage,
        'lib/driver_page.dart': driverPage,
        'lib/setup_help_page.dart': setupHelpPage,
        'FIREBASE_SETUP.md': SETUP_README,
      },
    };
  return null; // basic: `flutter create` को तयार Counter एप — the stock Counter app
}

/** Template का फाइल लेख्ने (नयाँ बनेको project भित्र मात्र) — write the files (only inside the freshly created project). */
export async function writeTemplateFiles(
  projectRoot: string,
  spec: TemplateSpec,
): Promise<void> {
  const root = path.resolve(projectRoot);
  const inside = (rel: string) => {
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep))
      throw new Error('Template path escapes the project: ' + rel);
    return full;
  };
  for (const rel of spec.remove)
    await fs.rm(inside(rel), { force: true }).catch(() => undefined);
  for (const [rel, content] of Object.entries(spec.files)) {
    const full = inside(rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
}
