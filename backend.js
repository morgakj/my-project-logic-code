const express = require('express');
const router = express.Router();

const bodyParser = require('body-parser');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const app = express();
const cors = require('cors');
const path = require('path');
const session = require('express-session');

const { time } = require('console');

// ENABLE CORS BEFORE ROUTES
app.use(cors());  // ✅ This line enables CORS
app.use(express.json()); // Needed for parsing JSON in POST requests


const port = 3000;
// PostgreSQL setup
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'exams_db',
    password: 'justice',
    port: 5432,
});

// Function to create admin with plain text password
const bcrypt = require('bcrypt');


async function createAdminUser() {
    const username = 'admin';
    const rawPassword = 'justice123';

    const hashedPassword = await bcrypt.hash(rawPassword, 10); // hash the password

    await pool.query(
        'INSERT INTO admins(username, password) VALUES ($1, $2)',
        [username, hashedPassword]
    );

    console.log('Secure admin user created!');
    process.exit();
}



app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
// Uncomment this line **once** to insert the admin, then comment it again to avoid duplicates
// createAdminUser();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session config
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: false,
}));

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});
app.get('/timetablepro', (req, res) => {
res.sendFile(path.join(__dirname, 'public', 'timetablepro.html'));

});


app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'loginpro.html'));
});
function requireLogin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: 'Unauthorized: Please log in' });
  }
  next();


}


app.get('/dashboard', (req, res) => {
    if (!req.session.adminId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'dashboardpro.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM admin WHERE username = $1', [username]);
        const admin = result.rows[0];

        if (admin && password === admin.password) {
            req.session.adminId = admin.id;
            return res.redirect('/dashboard');
        } else {
            return res.status(401).send('Invalid username or password');
        }
    } catch (err) {
        console.error('Error during login:', err);
        res.status(500).send('Internal server error');
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).send('Could not log out.');
        }
        res.redirect('/login');
    });
});




// Add Course
app.post('/courses', async (req, res) => {
  const { course_code, course_title, credit_unit, student_count, level } = req.body;
  try {
    await pool.query(
      'INSERT INTO courses (course_code, course_title, credit_unit, student_count, level) VALUES ($1, $2, $3, $4, $5)',
      [course_code, course_title, credit_unit, student_count, level]
    );
    res.json({ message: 'Course added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add course' });
  }
});

// Add Venue
app.post('/venues', async (req, res) => {
  const { name, capacity } = req.body;
  try {
    await pool.query('INSERT INTO venues (name, capacity) VALUES ($1, $2)', [name, capacity]);
    res.json({ message: 'Venue added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add venue' });
  }
});

// Add Invigilator
app.post('/invigilators', async (req, res) => {
  const { name1, name2, name3, department } = req.body;

  console.log('Received data:', { name1, name2, name3, department });

  if (!name1 || !name2 || !name3 || !department) {
    console.log('❌')
}
  try {
  await pool.query('BEGIN');

  try {
    await pool.query('INSERT INTO invigilators (name, department) VALUES ($1, $2)', [name1, department]);
    console.log('✔️ Inserted invigilator 1');
  } catch (err) {
    throw new Error('Invigilator 1 insert failed: ' + err.message);
  }

  try {
    await pool.query('INSERT INTO invigilators (name, department) VALUES ($1, $2)', [name2, department]);
    console.log('✔️ Inserted invigilator 2');
  } catch (err) {
    throw new Error('Invigilator 2 insert failed: ' + err.message);
  }

  try {
    await pool.query('INSERT INTO invigilators (name, department) VALUES ($1, $2)', [name3, department]);
    console.log('✔️ Inserted invigilator 3');
  } catch (err) {
    throw new Error('Invigilator 3 insert failed: ' + err.message);
  }
  
  await pool.query('COMMIT');
  res.json({ message: '3 Invigilators added successfully' });

} catch (err) {
  await pool.query('ROLLBACK');
  console.error('❌ Final error:', err.message);
  res.status(500).json({ error: err.message });

}
 });
app.get('/timetable',  async (req, res) => {

  try {
    const result = await pool.query(`
      SELECT t.id, c.course_code, c.course_title, v.name AS venue, t.date, t.time_slot,
        array_agg(i.name) AS invigilators
      FROM timetable t
      JOIN courses c ON c.id = t.course_id
      JOIN venues v ON v.id = t.venue_id
      JOIN timetable_invigilators ti ON ti.timetable_id = t.id
      JOIN invigilators i ON i.id = ti.invigilator_id
      GROUP BY t.id, c.course_code, c.course_title, v.name, t.date, t.time_slot
      ORDER BY t.date, t.time_slot
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch timetable:', err);
    res.status(500).json({ error: 'Could not fetch timetable' });
  }
});

app.post('/generate-timetable', async (req, res) => {
  try {
    const courses = (await pool.query('SELECT * FROM courses')).rows;
    const venues = (await pool.query('SELECT name FROM venues')).rows;
    const invigilators = (await pool.query('SELECT * FROM invigilators')).rows;

    const dates = ['2025-06-16', '2025-06-17', '2025-06-18', '2025-06-19', '2025-06-20','2025-06-23', '2025-06-24', '2025-06-25', '2025-06-26', '2025-06-27'];
    const timeSlots = ['8-10:00 AM', '12-3:00 PM', '4-6:00 PM'];

    const populationSize = 50;
    const generations = 100;
    const mutationRate = 0.1;

    function getRandomInvigilators(invigilators, count = 3) {
      const shuffled = [...invigilators].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, count).map(inv => inv.name);
    }

    function generateRandomTimetable() {
      return courses.map(course => ({
        course_code: course.course_code,
        venue: venues[Math.floor(Math.random() * venues.length)].name,
        day: dates[Math.floor(Math.random() * dates.length)],
        time: timeSlots[Math.floor(Math.random() * timeSlots.length)],
        invigilators: getRandomInvigilators(invigilators, 3)
      }));
    }

    function evaluateFitness(timetable) {
      let conflicts = 0;

      for (let i = 0; i < timetable.length; i++) {
        for (let j = i + 1; j < timetable.length; j++) {
          const examA = timetable[i];
          const examB = timetable[j];

          const sameSlot = examA.day === examB.day && examA.time === examB.time;

          if (sameSlot) {
            if (examA.venue === examB.venue) conflicts++;

            const sharedInvigilators = examA.invigilators.filter(inv =>
              examB.invigilators.includes(inv)
            );
            if (sharedInvigilators.length > 0) conflicts++;
          }
        }
      }

      return 1 / (1 + conflicts);
    }

    function crossover(parent1, parent2) {
      const crossoverPoint = Math.floor(Math.random() * parent1.length);
      return parent1.slice(0, crossoverPoint).concat(parent2.slice(crossoverPoint));
    }

    function mutate(timetable) {
      const index = Math.floor(Math.random() * timetable.length);
      timetable[index] = {
        ...timetable[index],
        venue: venues[Math.floor(Math.random() * venues.length)].name,
        day: dates[Math.floor(Math.random() * dates.length)],
        time: timeSlots[Math.floor(Math.random() * timeSlots.length)],
        invigilators: getRandomInvigilators(invigilators, 3)
      };
      return timetable;
    }

    // GA execution
    let population = Array.from({ length: populationSize }, generateRandomTimetable);

    for (let gen = 0; gen < generations; gen++) {
      population.sort((a, b) => evaluateFitness(b) - evaluateFitness(a));
      const newPopulation = population.slice(0, 10); // elitism

      while (newPopulation.length < populationSize) {
        const parent1 = population[Math.floor(Math.random() * 10)];
        const parent2 = population[Math.floor(Math.random() * 10)];
        let child = crossover(parent1, parent2);
        if (Math.random() < mutationRate) child = mutate(child);
        newPopulation.push(child);
      }

      population = newPopulation;
    }

    const bestTimetable = population[0];

    // Clear old timetable data
    await pool.query('DELETE FROM timetable');
    await pool.query('DELETE FROM timetable_invigilators');

    // Save to DB
    for (const exam of bestTimetable) {
      const courseResult = await pool.query('SELECT id FROM courses WHERE course_code = $1', [exam.course_code]);
      const venueResult = await pool.query('SELECT id FROM venues WHERE name = $1', [exam.venue]);

      const courseId = courseResult.rows[0]?.id;
      const venueId = venueResult.rows[0]?.id;

      if (!venueId) {
        console.error('Venue not found:', exam.venue);
        continue;
      }

      const timetableInsert = await pool.query(
        'INSERT INTO timetable (course_id, venue_id, date, time_slot) VALUES ($1, $2, $3, $4) RETURNING id',
        [courseId, venueId, exam.day, exam.time]
      );

      const timetableId = timetableInsert.rows[0].id;

      for (const invigilatorName of exam.invigilators) {
        const invigilatorResult = await pool.query('SELECT id FROM invigilators WHERE name = $1', [invigilatorName]);
        const invigilatorId = invigilatorResult.rows[0]?.id;

        if (invigilatorId) {
          await pool.query(
            'INSERT INTO timetable_invigilators (timetable_id, invigilator_id) VALUES ($1, $2)',
            [timetableId, invigilatorId]
          );
        } else {
          console.error('Invigilator not found in DB:', invigilatorName);
        }
        
      }
    }

    res.status(200).json({ message: 'Timetable generated successfully!' });

  } catch (error) {
    console.error('Error generating timetable:', error);
    res.status(500).json({ error: 'Error generating timetable' });
  }
   });
  
  


// pdf download function
app.get('/export-pdf', async (req, res) => {
  try {
    const data = (await pool.query(`
      SELECT t.id, c.course_code, c.course_title, v.name AS venue, t.date, t.time_slot,
        array_agg(i.name) AS invigilators
      FROM timetable t
      JOIN courses c ON c.id = t.course_id
      JOIN venues v ON v.id = t.venue_id
      JOIN timetable_invigilators ti ON ti.timetable_id = t.id
      JOIN invigilators i ON i.id = ti.invigilator_id
      GROUP BY t.id, c.course_code, c.course_title, v.name, t.date, t.time_slot
    `)).rows;

    // ✅ Create PDF document
    const doc = new PDFDocument();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=timetable.pdf');

    // ✅ Pipe the PDF into response
    doc.pipe(res);

    // ✅ Add content
    doc.fontSize(16).text(' 300 Level first semester 2024/2025 Examination Timetable', { align: 'center' });
    doc.moveDown();

    data.forEach(row => {
      doc.fontSize(12).text(`Course: ${row.course_code} - ${row.course_title}`);
      doc.text(`Venue: ${row.venue}`);
      doc.text(`Invigilators: ${row.invigilators.join(', ')}`);
      doc.text(`Date: ${row.date}`);
      doc.text(`Time Slot: ${row.time_slot}`);
      doc.moveDown();
    });

    // ✅ Finalize the PDF
    doc.end();
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});




// excel download function
app.get('/export-excel', async (req, res) => {
  try {
    const data = (await pool.query(`
      SELECT t.id, c.course_code, c.course_title, v.name AS venue, t.date, t.time_slot,
        array_agg(i.name) AS invigilators
      FROM timetable t
      JOIN courses c ON c.id = t.course_id
      JOIN venues v ON v.id = t.venue_id
      JOIN timetable_invigilators ti ON ti.timetable_id = t.id
      JOIN invigilators i ON i.id = ti.invigilator_id
      GROUP BY t.id, c.course_code, c.course_title, v.name, t.date, t.time_slot
    `)).rows;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(' Examination Timetable');
  

    // Add header row
    worksheet.addRow(['Course Code', 'Course Title', 'Venue', 'Invigilators', 'Date', 'Time Slot']);

    // Add data rows
    data.forEach(row => {
      worksheet.addRow([
        row.course_code,
        row.course_title,
        row.venue,
        row.invigilators.join(', '),
        row.date,
        row.time_slot
      ]);
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=timetable.xlsx');

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ error: 'Failed to generate Excel file' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});